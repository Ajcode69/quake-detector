/**
 * API + Alert Server — Process 2.
 * Starts Express, Kafka consumers, and daily digest cron.
 *
 * Usage:  npm run api
 */

import express from "express";
import cron from "node-cron";
import { config } from "../../../shared/config.js";
import { createLogger } from "../../../shared/logger.js";
import { disconnect } from "../../../shared/db/client.js";
import { startPostgresListener } from "./listeners/postgres.js";
import { sendTelegram } from "./services/notifier.service.js";
import { broadcastRiskUpdate } from "./services/persister.service.js";
import { computeAndBroadcast } from "./services/risk.service.js";
import { getUnsentAlerts, markAlertSent } from "./services/alert.service.js";
import eventsRouter from "./routes/events.js";
import healthRouter from "./routes/health.js";
import locationsRouter from "./routes/locations.js";
import geocodeRouter from "./routes/geocode.js";
import sseRouter from "./routes/sse.js";

const log = createLogger("api");
const app = express();

// ── Middleware ───────────────────────────────────────────────
app.use(express.json());
app.use((req, _res, next) => { req.log = log; next(); });
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE");
  next();
});

// ── Routes ──────────────────────────────────────────────────
app.use("/api/events", eventsRouter);
app.use("/api/health", healthRouter);
app.use("/api/locations", locationsRouter);
app.use("/api/geocode", geocodeRouter);
app.use("/api/stream", sseRouter);
app.get("/", (_req, res) => res.json({ service: "quake-detector-api", status: "ok" }));


// ── Daily digest cron ───────────────────────────────────────
function scheduleDailyDigest() {
  cron.schedule("0 8 * * *", async () => {
    log.info("running daily digest");
    try {
      // TODO: query events per user location for last 24h, format digest, send via Telegram
      log.info("daily digest complete");
    } catch (err) {
      log.error({ err }, "daily digest failed");
    }
  }, { timezone: "UTC" });
  log.info("daily digest cron scheduled (08:00 UTC)");
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
  log.info("alert retry sweep scheduled (every 5 min)");
}

// ── Risk scoring cron (every 5 min) ─────────────────────────
function scheduleRiskScoring() {
  // Run once on startup after a short delay
  setTimeout(() => {
    computeAndBroadcast(broadcastRiskUpdate).catch((err) => {
      log.error({ err }, "initial risk scoring failed");
    });
  }, 10_000);

  cron.schedule("*/5 * * * *", async () => {
    try {
      await computeAndBroadcast(broadcastRiskUpdate);
    } catch (err) {
      log.error({ err }, "risk scoring cron failed");
    }
  });
  log.info("risk scoring cron scheduled (every 5 min)");
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  await startPostgresListener();
  scheduleDailyDigest();
  scheduleAlertRetrySweep();
  scheduleRiskScoring();

  app.listen(config.port, () => {
    log.info({ port: config.port }, "API server listening");
  });

  async function shutdown(signal) {
    log.info({ signal }, "shutting down API server");
    try {
      await disconnect();
    } catch (err) {
      log.error({ err }, "error during shutdown");
    }
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  log.fatal({ err }, "API server crashed");
  process.exit(1);
});
