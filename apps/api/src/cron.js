import cron from "node-cron";
import pg from "pg";
import { config } from "../../../shared/config.js";
import { createLogger } from "../../../shared/logger.js";
import { disconnect } from "../../../shared/db/client.js";
import { runDailyDigest } from "./services/digest.service.js";
import { getUnsentAlerts, markAlertSent } from "./services/alert.service.js";
import { sendTelegram } from "./services/notifier.service.js";
import { computeAndBroadcast } from "./services/risk.service.js";

const log = createLogger("cron-worker");

// Setup PostgreSQL client for NOTIFY broadcasts
const pgClient = new pg.Client({ connectionString: config.databaseUrl });
await pgClient.connect();

async function broadcastRiskUpdatePG(payload) {
  try {
    // To be perfectly safe against the 8000-byte PG NOTIFY limit,
    // we notify each location's score individually.
    for (const score of payload.scores) {
      const msg = JSON.stringify({
        type: "risk_update",
        scores: [score],
        timestamp: payload.timestamp
      });
      await pgClient.query("SELECT pg_notify('risk_updates', $1)", [msg]);
    }
    log.info({ count: payload.scores.length }, "Risk scoring notified via pg_notify");
  } catch (err) {
    log.error({ err }, "Failed to send pg_notify for risk updates");
  }
}

// ── Daily digest cron ───────────────────────────────────────
function scheduleDailyDigest() {
  cron.schedule("0 8 * * *", async () => {
    try {
      log.info("Running daily digest...");
      await runDailyDigest();
    } catch (err) {
      log.error({ err }, "Daily digest cron failed");
    }
  }, { timezone: "UTC" });
  log.info("Daily digest cron scheduled (08:00 UTC)");
}

// ── Unsent alert retry sweep ────────────────────────────────
function scheduleAlertRetrySweep() {
  cron.schedule("*/5 * * * *", async () => {
    try {
      const unsent = await getUnsentAlerts(20);
      if (unsent.length === 0) return;

      log.info({ count: unsent.length }, "retrying unsent alerts");

      for (const alert of unsent) {
        const sent = await sendTelegram(String(alert.chatId), alert.message);
        if (sent) {
          await markAlertSent(alert.id);
          log.info({ alertId: alert.id }, "retry delivered");
        }
      }
    } catch (err) {
      log.error({ err }, "alert retry sweep failed");
    }
  });
  log.info("Alert retry sweep scheduled (every 5 min)");
}

// ── Risk scoring cron (every 5 min) ─────────────────────────
function scheduleRiskScoring() {
  // Run once on startup after a short delay
  setTimeout(() => {
    computeAndBroadcast(broadcastRiskUpdatePG).catch((err) => {
      log.error({ err }, "initial risk scoring failed");
    });
  }, 10_000);

  cron.schedule("*/5 * * * *", async () => {
    try {
      await computeAndBroadcast(broadcastRiskUpdatePG);
    } catch (err) {
      log.error({ err }, "risk scoring cron failed");
    }
  });
  log.info("Risk scoring cron scheduled (every 5 min)");
}

async function main() {
  scheduleDailyDigest();
  scheduleAlertRetrySweep();
  scheduleRiskScoring();

  log.info("Cron worker successfully started");

  async function shutdown(signal) {
    log.info({ signal }, "Shutting down cron worker");
    try {
      await pgClient.end();
      await disconnect();
    } catch (err) {
      log.error({ err }, "Error during shutdown");
    }
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  log.fatal({ err }, "Cron worker crashed");
  process.exit(1);
});
