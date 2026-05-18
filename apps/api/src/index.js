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
import { createKafkaClient } from "../../../shared/kafka/client.js";
import { startPersister } from "./consumers/persister.js";
import { startEvaluator } from "./consumers/evaluator.js";
import { startNotifier } from "./consumers/notifier.js";
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

// ── Kafka consumers ─────────────────────────────────────────
async function startConsumers() {
  const kafka = createKafkaClient("api-server");

  const persisterConsumer = kafka.consumer({ groupId: "event-persister" });
  const evaluatorConsumer = kafka.consumer({ groupId: "alert-evaluator" });
  const notifierConsumer = kafka.consumer({ groupId: "telegram-notifier" });
  const alertProducer = kafka.producer();

  await Promise.all([
    persisterConsumer.connect(),
    evaluatorConsumer.connect(),
    notifierConsumer.connect(),
    alertProducer.connect(),
  ]);

  log.info("all kafka consumers + producer connected");

  await startPersister(persisterConsumer);
  await startEvaluator(evaluatorConsumer, alertProducer);
  await startNotifier(notifierConsumer);

  return { persisterConsumer, evaluatorConsumer, notifierConsumer, alertProducer };
}

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

// ── Main ────────────────────────────────────────────────────
async function main() {
  const consumers = await startConsumers();
  scheduleDailyDigest();

  app.listen(config.port, () => {
    log.info({ port: config.port }, "API server listening");
  });

  async function shutdown(signal) {
    log.info({ signal }, "shutting down API server");
    try {
      await consumers.persisterConsumer.disconnect();
      await consumers.evaluatorConsumer.disconnect();
      await consumers.notifierConsumer.disconnect();
      await consumers.alertProducer.disconnect();
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
