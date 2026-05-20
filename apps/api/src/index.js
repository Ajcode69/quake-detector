/**
 * API + Alert Server — Process 2.
 * Starts Express, Kafka consumers, and daily digest cron.
 *
 * Usage:  npm run api
 */

import express from "express";
import { config } from "../../../shared/config.js";
import { createLogger } from "../../../shared/logger.js";
import { disconnect } from "../../../shared/db/client.js";
import { startPostgresListener } from "./listeners/postgres.js";
import { setupMaterializedViews } from "./services/digest.service.js";
import eventsRouter from "./routes/events.js";
import healthRouter from "./routes/health.js";
import locationsRouter from "./routes/locations.js";
import geocodeRouter from "./routes/geocode.js";
import sseRouter from "./routes/sse.js";
import statsRouter from "./routes/stats.js";
import alertsRouter from "./routes/alerts.js";
import healthDetailedRouter from "./routes/health-detailed.js";
import locationRiskRouter from "./routes/location-risk.js";
import authRouter from "./routes/auth.js";
import { startTelegramBot, stopTelegramBot } from "./services/telegram.service.js";

const log = createLogger("api");
const app = express();

// ── Middleware ───────────────────────────────────────────────
app.use(express.json());
app.use((req, _res, next) => { req.log = log; next(); });
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, x-user-id");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, PUT");
  next();
});

// ── Routes ──────────────────────────────────────────────────
app.use("/api/events", eventsRouter);
app.use("/api/health", healthRouter);
app.use("/api/locations", locationsRouter);
app.use("/api/geocode", geocodeRouter);
app.use("/api/stream", sseRouter);
app.use("/api/stats", statsRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/health/detailed", healthDetailedRouter);
app.use("/api/locations", locationRiskRouter);
app.use("/api/auth", authRouter);
app.get("/", (_req, res) => res.json({ service: "quake-detector-api", status: "ok" }));


// ── Main ────────────────────────────────────────────────────
async function main() {
  await startPostgresListener();
  await setupMaterializedViews();
  await startTelegramBot();

  app.listen(config.port, () => {
    log.info({ port: config.port }, "API server listening");
  });

  async function shutdown(signal) {
    log.info({ signal }, "shutting down API server");
    stopTelegramBot();
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

