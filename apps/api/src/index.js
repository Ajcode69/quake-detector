/**
 * API + Alert Server — Process 2.
 *
 * Starts:
 *   1. Express API server (REST + SSE)
 *   2. Three Kafka consumers (persister, evaluator, notifier)
 *   3. Daily digest cron job
 *
 * Usage:  npm run api
 */

import express from "express";
import cron from "node-cron";
import { config } from "../../../shared/config.js";
import { createLogger } from "../../../shared/logger.js";
import { closePool } from "../../../shared/db/connection.js";
import { createKafkaClient } from "../../../shared/kafka/client.js";
import { startPersister } from "./consumers/persister.js";
import { startEvaluator } from "./consumers/evaluator.js";
import { startNotifier } from "./consumers/notifier.js";
import eventsRouter from "./routes/events.js";
import healthRouter from "./routes/health.js";
import locationsRouter from "./routes/locations.js";
import sseRouter from "./routes/sse.js";

const log = createLogger("api");
const app = express();

// ── Middleware ───────────────────────────────────────────────
app.use(express.json());

// Attach logger to every request
app.use((req, _res, next) => {
  req.log = log;
  next();
});

// CORS (permissive for dev — lock down in production)
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
app.use("/api/stream", sseRouter);

// Root health check (for load balancers)
app.get("/", (_req, res) => {
  res.json({ service: "quake-detector-api", status: "ok" });
});

// ── Kafka consumers ─────────────────────────────────────────
async function startConsumers() {
  const kafka = createKafkaClient("api-server");

  // Each consumer group reads independently
  const persisterConsumer = kafka.consumer({ groupId: "event-persister" });
  const evaluatorConsumer = kafka.consumer({ groupId: "alert-evaluator" });
  const notifierConsumer = kafka.consumer({ groupId: "telegram-notifier" });

  // Evaluator also needs a producer (to produce to alerts topic)
  const alertProducer = kafka.producer();

  await Promise.all([
    persisterConsumer.connect(),
    evaluatorConsumer.connect(),
    notifierConsumer.connect(),
    alertProducer.connect(),
  ]);

  log.info("all kafka consumers + producer connected");

  // Start consumers
  await startPersister(persisterConsumer);
  await startEvaluator(evaluatorConsumer, alertProducer);
  await startNotifier(notifierConsumer);

  return { persisterConsumer, evaluatorConsumer, notifierConsumer, alertProducer };
}

// ── Daily digest cron ───────────────────────────────────────
function scheduleDailyDigest() {
  // Runs at 08:00 UTC every day
  cron.schedule("0 8 * * *", async () => {
    log.info("running daily digest");
    try {
      // TODO: Implement digest logic
      // 1. Query all user_locations
      // 2. For each user, get events near their locations in the last 24h
      // 3. Format a summary and send via Telegram
      log.info("daily digest complete");
    } catch (err) {
      log.error({ err }, "daily digest failed");
    }
  }, { timezone: "UTC" });

  log.info("daily digest cron scheduled (08:00 UTC)");
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  // Start Kafka consumers
  const consumers = await startConsumers();

  // Schedule daily digest
  scheduleDailyDigest();

  // Start Express server
  app.listen(config.port, () => {
    log.info({ port: config.port }, "API server listening");
  });

  // ── Graceful shutdown ─────────────────────────────────────
  async function shutdown(signal) {
    log.info({ signal }, "shutting down API server");
    try {
      await consumers.persisterConsumer.disconnect();
      await consumers.evaluatorConsumer.disconnect();
      await consumers.notifierConsumer.disconnect();
      await consumers.alertProducer.disconnect();
      await closePool();
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
