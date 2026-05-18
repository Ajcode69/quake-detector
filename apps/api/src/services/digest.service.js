import prisma from "../../../../shared/db/client.js";
import { createLogger } from "../../../../shared/logger.js";
import { formatAlertMessage } from "./notifier.service.js";
import { saveAlert } from "./alert.service.js";

const log = createLogger("service:digest");

/**
 * Ensure the Materialized View exists for the Daily Digest.
 * This runs on server startup.
 */
export async function setupMaterializedViews() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS daily_digest_mv AS
      SELECT 
        COUNT(*)::int AS "total",
        MAX(mag)::float AS "maxMag",
        COUNT(CASE WHEN mag >= 5.0 THEN 1 END)::int AS "significantCount"
      FROM earthquakes
      WHERE event_time > NOW() - INTERVAL '1 day'
    `);
    log.info("Daily digest materialized view ensured");
  } catch (err) {
    log.warn({ err }, "Could not ensure materialized view (might already exist or DB restricted)");
  }
}

/**
 * Runs the daily digest compilation and dispatch for all users.
 */
export async function runDailyDigest() {
  log.info("Starting daily digest compilation...");

  try {
    // 1. Refresh and Query the Materialized View for Global Stats
    log.info("Refreshing materialized view...");
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW daily_digest_mv`);

    const globalStatsResult = await prisma.$queryRaw`
      SELECT total, "maxMag", "significantCount" FROM daily_digest_mv
    `;
    
    const globalStats = globalStatsResult[0] || { total: 0, maxMag: 0, significantCount: 0 };

    if (globalStats.total === 0) {
      log.info("No earthquakes in the last 24 hours. Skipping digest.");
      return;
    }

    // 2. Fetch all user locations to build personalized digests
    const userLocations = await prisma.userLocation.findMany({
      select: {
        id: true,
        label: true,
        latitude: true,
        longitude: true,
        radiusKm: true,
        telegramChatId: true,
      }
    });

    // Group locations by Telegram Chat ID to send one combined message per user
    const users = {};
    for (const loc of userLocations) {
      if (!users[loc.telegramChatId]) users[loc.telegramChatId] = [];
      users[loc.telegramChatId].push(loc);
    }

    // 3. Dispatch digest to each user
    for (const [chatIdStr, locations] of Object.entries(users)) {
      const chatId = BigInt(chatIdStr);
      let localSummary = "";

      for (const loc of locations) {
        // Query local earthquakes for this specific location
        const localStats = await prisma.$queryRaw`
          SELECT 
            COUNT(*)::int AS "localCount",
            MAX(mag)::float AS "localMaxMag"
          FROM earthquakes
          WHERE event_time > NOW() - INTERVAL '1 day'
            AND ST_DWithin(geog, ST_SetSRID(ST_MakePoint(${loc.longitude}, ${loc.latitude}), 4326)::geography, ${loc.radiusKm * 1000})
        `;

        const ls = localStats[0];
        if (ls && ls.localCount > 0) {
          localSummary += `\n📍 **${loc.label}**: ${ls.localCount} events (Largest: M${ls.localMaxMag})`;
        } else {
          localSummary += `\n📍 **${loc.label}**: Quiet (0 events)`;
        }
      }

      // Build Telegram message
      const text = `
🌅 **DAILY SEISMIC DIGEST**

🌍 **Global Overview (Last 24h):**
• Total Earthquakes: ${globalStats.total}
• Significant (M5.0+): ${globalStats.significantCount}
• Largest Event: M${globalStats.maxMag}

🏠 **Your Tracked Locations:**${localSummary}

_To adjust your alert radii or quiet hours, visit your dashboard._
      `.trim();

      // Save alert to database and trigger NOTIFY
      const saved = await saveAlert({
        eventId: null,
        chatId: String(chatId),
        ruleType: "digest",
        severity: "info",
        message: text,
        isRevision: false,
        dedupHash: `digest-${new Date().toISOString().split('T')[0]}-${chatId}` // Unique per day per user
      });

      if (saved) {
        await prisma.$executeRawUnsafe(`NOTIFY earthquake_alerts, '{"id": ${saved.id}}'`);
      }
    }

    log.info({ userCount: Object.keys(users).length }, "Daily digest compiled and dispatched.");

  } catch (err) {
    log.error({ err }, "Failed to run daily digest");
  }
}
