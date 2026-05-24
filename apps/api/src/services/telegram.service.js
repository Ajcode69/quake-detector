import { config } from "../../../../shared/config.js";
import { createLogger } from "../../../../shared/logger.js";
import { searchLocations } from "../../../../shared/geocoder.js";
import { createLocation, getLocations, deleteLocation } from "./location.service.js";
import { invalidateLocationCache } from "./location.cache.js";
import { sendTelegram } from "./notifier.service.js";
import { getHealth } from "./health.service.js";
import prisma from "../../../../shared/db/client.js";
import {
  runChatAgent,
  discoverCriticalContacts,
  formatContactsSummary,
} from "../agents/index.js";

const log = createLogger("telegram-bot");

const TELEGRAM_API = `https://api.telegram.org/bot${config.telegramBotToken}`;

let offset = 0;
let isPolling = false;
let pollTimer = null;
const POLL_TIMEOUT_SEC = 30; // Telegram long-poll timeout
const RETRY_DELAY_MS = 5_000;

// Track registered chat IDs to avoid redundant DB lookups on every message
const knownChatIds = new Set();

/**
 * Start the Telegram bot polling loop.
 */
export async function startTelegramBot() {
  if (!config.telegramBotToken) {
    log.warn("TELEGRAM_BOT_TOKEN not set — bot polling disabled");
    return;
  }

  // Pre-populate known chat IDs from DB
  try {
    const existing = await prisma.telegramChat.findMany({
      select: { telegramChatId: true }
    });
    for (const row of existing) {
      knownChatIds.add(String(row.telegramChatId));
    }
    log.info({ knownChatIds: knownChatIds.size }, "pre-loaded known chat IDs");
  } catch (err) {
    log.warn({ err }, "failed to pre-load chat IDs");
  }

  log.info("Telegram bot polling started");
  pollUpdates();
}

/**
 * Stop the bot polling loop.
 */
export function stopTelegramBot() {
  if (pollTimer) clearTimeout(pollTimer);
  isPolling = false;
  log.info("Telegram bot polling stopped");
}

// ── Polling loop ────────────────────────────────────────────

async function pollUpdates() {
  if (isPolling) return;
  isPolling = true;

  try {
    const url = `${TELEGRAM_API}/getUpdates?offset=${offset}&timeout=${POLL_TIMEOUT_SEC}&allowed_updates=["message"]`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout((POLL_TIMEOUT_SEC + 10) * 1000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error({ status: res.status, body }, "getUpdates failed");
      scheduleRetry();
      return;
    }

    const data = await res.json();

    if (data.ok && data.result?.length > 0) {
      for (const update of data.result) {
        offset = update.update_id + 1;
        await handleUpdate(update).catch((err) => {
          log.error({ err, updateId: update.update_id }, "failed to handle update");
        });
      }
    }
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      // Normal — long poll timed out, loop again
    } else {
      log.error({ err }, "Telegram polling error");
      scheduleRetry();
      return;
    }
  } finally {
    isPolling = false;
  }

  // Immediately poll again (long polling returns fast when there are updates)
  pollTimer = setTimeout(pollUpdates, 100);
}

function scheduleRetry() {
  isPolling = false;
  pollTimer = setTimeout(pollUpdates, RETRY_DELAY_MS);
}

// ── Update handler ──────────────────────────────────────────

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || !msg.chat) return;

  const chatId = String(msg.chat.id);
  const text = (msg.text || "").trim();
  const firstName = msg.from?.first_name || "there";

  // Auto-register: ensure this chat ID exists in the system
  await ensureRegistered(chatId, firstName);

  // Route commands
  if (text.startsWith("/")) {
    const [cmd, ...args] = text.split(/\s+/);
    const command = cmd.toLowerCase().replace(/@\w+$/, ""); // strip @botname

    switch (command) {
      case "/start":
      case "/help":
        return handleHelp(chatId, firstName);
      case "/addlocation":
        return handleAddLocation(chatId, args.join(" "));
      case "/removelocation":
        return handleRemoveLocation(chatId, args[0]);
      case "/locations":
        return handleListLocations(chatId);
      case "/status":
        return handleStatus(chatId);
      case "/digest":
        return handleManualDigest(chatId);
      default:
        return sendReply(chatId, `❓ Unknown command: \`${command}\`\n\nType /help for available commands.`);
    }
  }

  // Non-command message — route to AI agent
  if (text.length >= 2) {
    return handleAgentMessage(chatId, text);
  }
}

/**
 * Auto-register a user on their first message.
 * No /start needed — any message triggers registration.
 */
async function ensureRegistered(chatId, firstName) {
  if (knownChatIds.has(chatId)) return;

  // Check if they already exist in the TelegramChat table
  const existing = await prisma.telegramChat.findUnique({
    where: { telegramChatId: BigInt(chatId) },
  });

  if (existing) {
    knownChatIds.add(chatId);
    return;
  }

  // New registration
  await prisma.telegramChat.create({
    data: {
      telegramChatId: BigInt(chatId),
      userId: 1, // Default to our admin user
    }
  });

  knownChatIds.add(chatId);

  // New user — send welcome message
  knownChatIds.add(chatId);

  const welcome = `
👋 *Welcome to QuakeDetector, ${firstName}!*

I'll send you real-time earthquake alerts and a daily digest.

🚀 *Quick start:* Add a location with /addlocation, or ask me anything about earthquakes.

Example: \`/addlocation Tokyo\`
Or ask: "What were the largest quakes in the last 24 hours?"

*Commands:*
• /addlocation <city> — Monitor a location
• /locations — See your monitored locations
• /removelocation <id> — Stop monitoring
• /status — System health
• /help — All commands

${config.dashboardUrl ? `📊 [Open Dashboard](${config.dashboardUrl})` : ""}
  `.trim();

  await sendReply(chatId, welcome);
}

// ── Command handlers ────────────────────────────────────────

async function handleHelp(chatId, firstName) {
  const msg = `
🌍 *QuakeDetector Bot* — Earthquake Monitoring

*Commands:*
• /addlocation <city> — Add a location to monitor (max 3)
• /removelocation <id> — Remove a monitored location
• /locations — List your monitored locations
• /status — System health + ingestion status
• /digest — Request today's digest now
• /help — Show this message

💡 *Ask me anything:* Type a question about earthquakes, alerts, or your locations — I'll search the database and web to answer.

*What you'll receive:*
🔴 Real-time alerts for M5.0+ globally
🟡 Proximity alerts for events near your locations
🔄 Swarm detection warnings
📊 Daily digest at 08:00 UTC

${config.dashboardUrl ? `📊 [Open Dashboard](${config.dashboardUrl})` : ""}
  `.trim();

  await sendReply(chatId, msg);
}

async function handleAgentMessage(chatId, text) {
  await sendReply(chatId, "🤔 Thinking...");

  try {
    const answer = await runChatAgent({ message: text, userId: 1, chatId });
    await sendReply(chatId, answer);
  } catch (err) {
    log.error({ err, chatId }, "agent message failed");
    await sendReply(chatId, "❌ Sorry, I couldn't process that. Try /help for commands.");
  }
}

async function handleAddLocation(chatId, query) {
  if (!query || query.length < 2) {
    return sendReply(chatId, "📍 Please provide a city name.\n\nExample: `/addlocation Tokyo`");
  }

  // Check location limit (max 3)
  const existing = await getLocations(1);
  if (existing.length >= 3) {
    return sendReply(
      chatId,
      `⚠️ You already have 3 monitored locations (max).\n\nRemove one first with /removelocation <id>\n\nYour locations:\n${existing.map((l) => `  ${l.id}. ${l.label}`).join("\n")}`
    );
  }

  // Geocode the query
  await sendReply(chatId, `🔍 Looking up "${query}"...`);

  const results = await searchLocations(query);
  if (results.length === 0) {
    return sendReply(chatId, `❌ Couldn't find "${query}". Try a different spelling or a larger city.`);
  }

  // Take the top result
  const best = results[0];
  const label = best.shortName || best.displayName.split(",").slice(0, 2).join(",").trim();

  try {
    const location = await createLocation({
      label,
      latitude: best.lat,
      longitude: best.lon,
      radiusKm: 500,
      userId: 1,
    });

    await invalidateLocationCache();

    const msg = `
✅ *Location added!*

📍 *${label}*
🌐 ${best.lat.toFixed(4)}°, ${best.lon.toFixed(4)}°
📏 Monitoring radius: 500 km

*Active alert thresholds:*
• 🔴 M5.0+ events globally
• 🟡 M3.0+ events within 500 km
• 🔄 Swarm: 5+ quakes in 30 min within 200 km
• ⚠️ Source silence: USGS down > 10 min

Location ID: \`${location.id}\`
    `.trim();

    await sendReply(chatId, msg);

    await sendReply(chatId, "🔍 Searching emergency alert contacts for this region...");
    discoverCriticalContacts({
      location,
      onComplete: async (contacts, err) => {
        if (err) {
          await sendReply(chatId, "⚠️ Couldn't find emergency contacts right now. Location is still monitored.");
          return;
        }
        await sendReply(chatId, formatContactsSummary(contacts));
      },
    }).catch((err) => log.error({ err, locationId: location.id }, "contact discovery background error"));
  } catch (err) {
    log.error({ err, query, chatId }, "failed to add location via Telegram");
    await sendReply(chatId, "❌ Failed to add location. Please try again.");
  }
}

async function handleRemoveLocation(chatId, idStr) {
  if (!idStr) {
    const locations = await getLocations(1);
    if (locations.length === 0) {
      return sendReply(chatId, "📍 You have no monitored locations.");
    }
    const list = locations.map((l) => `  \`${l.id}\` — ${l.label}`).join("\n");
    return sendReply(chatId, `Which location to remove?\n\n${list}\n\nUsage: /removelocation <id>`);
  }

  const id = parseInt(idStr);
  if (isNaN(id)) {
    return sendReply(chatId, "❌ Invalid location ID. Use /locations to see your IDs.");
  }

  // Verify ownership
  const locations = await getLocations(1);
  const owns = locations.find((l) => l.id === id);
  if (!owns) {
    return sendReply(chatId, "❌ Location not found or doesn't belong to you.");
  }

  try {
    await deleteLocation(id);
    await invalidateLocationCache();
    await sendReply(chatId, `🗑️ Removed: *${owns.label}*`);
  } catch (err) {
    log.error({ err, id, chatId }, "failed to remove location");
    await sendReply(chatId, "❌ Failed to remove location.");
  }
}

async function handleListLocations(chatId) {
  const locations = await getLocations(1);

  if (locations.length === 0) {
    return sendReply(
      chatId,
      "📍 No monitored locations.\n\nAdd one: `/addlocation Tokyo`"
    );
  }

  // Fetch latest risk scores for each location
  let riskInfo = "";
  try {
    for (const loc of locations) {
      const risk = await prisma.locationRiskScore.findFirst({
        where: { locationId: loc.id },
        orderBy: { timestamp: "desc" },
        select: { displayedRisk: true, riskLevel: true },
      });

      const riskEmoji = { Low: "🟢", Moderate: "🟡", High: "🟠", Critical: "🔴" };
      const emoji = riskEmoji[risk?.riskLevel] || "⚪";
      const score = risk ? `${emoji} ${risk.riskLevel} (${Math.round(risk.displayedRisk)}/100)` : "⚪ No data yet";

      riskInfo += `\n\n📍 *${loc.label}* (ID: \`${loc.id}\`)`;
      riskInfo += `\n   📏 Radius: ${loc.radiusKm} km`;
      riskInfo += `\n   📊 Risk: ${score}`;
      riskInfo += `\n   🎯 Alert: M3.0+ within ${loc.radiusKm}km`;
    }
  } catch (err) {
    log.warn({ err }, "failed to fetch risk scores for locations list");
    for (const loc of locations) {
      riskInfo += `\n\n📍 *${loc.label}* (ID: \`${loc.id}\`) — ${loc.radiusKm}km radius`;
    }
  }

  await sendReply(chatId, `🗺️ *Your Monitored Locations* (${locations.length}/3):${riskInfo}`);
}

async function handleStatus(chatId) {
  try {
    const health = await getHealth();
    const s = health.stats;
    const lastPoll = health.lastPoll;

    const statusEmoji = health.status === "healthy" ? "🟢" : (health.status === "offline" ? "🔴" : "🟡");
    const lastPollTime = lastPoll
      ? new Date(lastPoll.polledAt).toISOString().replace("T", " ").slice(0, 19) + " UTC"
      : "Never";

    const msg = `
${statusEmoji} *System Status: ${health.status.toUpperCase()}*

📡 *Ingestion:*
• Last poll: ${lastPollTime}
• Status: ${lastPoll?.status || "unknown"}
• Events fetched: ${lastPoll?.eventsFetched ?? "—"}
• New events: ${lastPoll?.newEvents ?? "—"}

📊 *Database:*
• Total events: ${s?.totalEvents?.toLocaleString() ?? "—"}
• Events (last hour): ${s?.eventsLastHour ?? "—"}
• Alerts (24h): ${s?.alerts24h ?? "—"}
• Unsent alerts: ${s?.unsentAlerts ?? "—"}

${config.dashboardUrl ? `📊 [Full Dashboard](${config.dashboardUrl})` : ""}
    `.trim();

    await sendReply(chatId, msg);
  } catch (err) {
    log.error({ err }, "status command failed");
    await sendReply(chatId, "❌ Failed to fetch system status.");
  }
}

async function handleManualDigest(chatId) {
  await sendReply(chatId, "📊 Generating digest... (this may take a moment)");

  try {
    // Quick inline digest — not the full cron one, just a summary
    const stats = await prisma.$queryRaw`
      SELECT
        COUNT(*)::int AS total,
        MAX(mag)::float AS "maxMag",
        COUNT(CASE WHEN mag >= 5.0 THEN 1 END)::int AS "significant",
        COUNT(CASE WHEN mag >= 4.0 AND mag < 5.0 THEN 1 END)::int AS "m4",
        COUNT(CASE WHEN mag >= 3.0 AND mag < 4.0 THEN 1 END)::int AS "m3",
        COUNT(CASE WHEN mag >= 2.0 AND mag < 3.0 THEN 1 END)::int AS "m2",
        COUNT(CASE WHEN mag >= 1.0 AND mag < 2.0 THEN 1 END)::int AS "m1",
        COUNT(CASE WHEN mag < 1.0 THEN 1 END)::int AS "m0"
      FROM earthquakes
      WHERE event_time > NOW() - INTERVAL '1 day'
    `;

    const s = stats[0] || {};

    const msg = `
📊 *Quick Digest (Last 24h)*

🌍 *Global:* ${s.total || 0} earthquakes
📈 Largest: M${s.maxMag || 0}

*By magnitude:*
• M5.0+: ${s.significant || 0}
• M4.0–4.9: ${s.m4 || 0}
• M3.0–3.9: ${s.m3 || 0}
• M2.0–2.9: ${s.m2 || 0}
• M1.0–1.9: ${s.m1 || 0}
• M0–0.9: ${s.m0 || 0}

_Full daily digest is sent automatically at 08:00 UTC._
    `.trim();

    await sendReply(chatId, msg);
  } catch (err) {
    log.error({ err }, "manual digest failed");
    await sendReply(chatId, "❌ Failed to generate digest.");
  }
}

// ── Helpers ─────────────────────────────────────────────────

async function sendReply(chatId, text) {
  return sendTelegram(chatId, text);
}
