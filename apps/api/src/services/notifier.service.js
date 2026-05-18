/**
 * Consumer: telegram-notifier
 * Reads earthquake.alerts → formats message → sends via Telegram → marks sent.
 * Handles: normal alerts, revision alerts, swarm alerts, system alerts.
 */

import { createLogger } from "../../../../shared/logger.js";
import { markAlertSent } from "../services/alert.service.js";
import { config } from "../../../../shared/config.js";
import prisma from "../../../../shared/db/client.js";

const log = createLogger("notifier");

const TELEGRAM_API = `https://api.telegram.org/bot${config.telegramBotToken}`;

export async function processAlertId(alertId) {
  try {
    const saved = await prisma.alertLog.findUnique({ where: { id: alertId } });
    if (!saved || saved.sent) return;

    const sent = await sendTelegram(saved.chatId, saved.message);
    if (sent) {
      await markAlertSent(saved.id);
      log.info({ alertId: saved.id, chatId: String(saved.chatId), severity: saved.severity }, "alert delivered");
    } else {
      log.warn({ alertId: saved.id, chatId: String(saved.chatId) }, "alert saved but delivery failed — retry sweep will pick it up");
    }
  } catch (err) {
    log.error({ err, alertId }, "failed to process alert");
  }
}

// ── Message formatting ──────────────────────────────────────

export function formatAlertMessage(alert) {
  const { rules, _systemAlert, riskScores } = alert;

  // System alerts (source silence)
  if (_systemAlert) return formatSystemAlert(alert);

  // Swarm alerts
  const swarmRule = rules.find((r) => r.type === "swarm");
  if (swarmRule) return formatSwarmAlert(alert, swarmRule);

  // Risk score alerts
  const riskRule = rules.find((r) => r.type?.startsWith("risk_"));
  if (riskRule) return formatRiskAlert(alert);

  // Normal earthquake alerts
  return formatEarthquakeAlert(alert);
}

function formatEarthquakeAlert(alert) {
  const { eventId, rules, severity, isRevision, event } = alert;
  const { mag, place, sig, tsunami, depth, alert: pagerLevel } = event;

  const emoji = { critical: "🔴", warning: "🟡", info: "🔵" };
  const header = isRevision
    ? `${emoji[severity] || "⚪"} *REVISED EARTHQUAKE ALERT*`
    : `${emoji[severity] || "⚪"} *EARTHQUAKE ALERT*`;

  const rulesText = rules.map((r) => `  • _${r.type}_: ${r.reason}`).join("\n");

  let details = `📍 *${place}*\n`;
  details += `💪 Magnitude: *M${mag}*\n`;
  details += `📊 Significance: ${sig}/1000\n`;
  details += `📏 Depth: ${depth}km\n`;
  if (pagerLevel) details += `🚨 PAGER Level: *${pagerLevel.toUpperCase()}*\n`;
  if (tsunami === 1) details += `🌊 *TSUNAMI WARNING ISSUED*\n`;

  const link = `https://earthquake.usgs.gov/earthquakes/eventpage/${eventId}`;
  return `${header}\n\n${details}\n*Triggered rules:*\n${rulesText}\n\n[View on USGS](${link})`;
}

function formatSwarmAlert(alert, swarmRule) {
  const { event } = alert;
  const s = swarmRule.swarmData;

  let msg = `🟡 *SWARM ALERT*\n\n`;
  msg += `🔄 *${s.count} earthquakes* detected within ${s.radiusKm}km in the last ${s.windowHours} hours\n\n`;
  msg += `📍 Near: *${event.place || "Unknown"}*\n`;
  msg += `📊 Largest: *M${s.maxMag}* | Average: M${s.avgMag}\n`;

  // Include proximity info from other rules
  const proxRule = alert.rules.find((r) => r.type === "proximity");
  if (proxRule) {
    msg += `📏 ${proxRule.distanceKm}km from "${proxRule.locationLabel}"\n`;
  }

  msg += `\n_This may indicate elevated seismic activity in the region. Individual events are small, but the pattern is noteworthy._`;

  return msg;
}

function formatRiskAlert(alert) {
  const { rules, riskScores, actionGuidance, event } = alert;

  const emoji = { critical: "🔴", warning: "🟡", info: "🔵" };
  const levelEmoji = emoji[alert.severity] || "⚪";

  let msg = `${levelEmoji} *RISK SCORE ALERT*\n\n`;
  msg += `📍 *${event.place}*\n\n`;

  if (riskScores) {
    msg += `📊 *Risk Scores:*\n`;
    msg += `  • Static: ${riskScores.static}/100\n`;
    msg += `  • Trend: ${riskScores.delta}/100\n`;
    msg += `  • Post-Event: ${riskScores.postEvent}/100\n`;
    msg += `  • **Overall: ${riskScores.displayed}/100 (${riskScores.level})**\n\n`;
  }

  msg += `*Triggered:*\n`;
  msg += rules.map((r) => `  • _${r.type}_: ${r.reason}`).join("\n");

  if (actionGuidance) {
    msg += `\n\n💡 *Action:* ${actionGuidance.message}`;
  }

  return msg;
}

function formatSystemAlert(alert) {
  const rule = alert.rules[0];
  return `⚠️ *SYSTEM ALERT*\n\n${rule.reason}\n\n_The earthquake data source may be temporarily unavailable. Monitoring continues automatically._`;
}

// ── Telegram delivery ───────────────────────────────────────

export async function sendTelegram(chatId, text, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) return true;

      const body = await response.json().catch(() => ({}));
      if (response.status === 429) {
        const retryAfter = body.parameters?.retry_after || 5;
        log.warn({ retryAfter, chatId }, "Telegram rate limited");
        await sleep(retryAfter * 1000);
        continue;
      }

      log.error({ status: response.status, body, chatId }, "Telegram API error");
    } catch (err) {
      log.error({ err, attempt, chatId }, "Telegram send failed");
      if (attempt < retries) await sleep(Math.pow(2, attempt) * 1000);
    }
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
