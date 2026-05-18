/**
 * Ingestion Worker — Process 1.
 *
 * Runs the USGS poller on a cron schedule with proper retry logic.
 * Connects Kafka producer, schedules polling, handles graceful shutdown.
 *
 * Usage:  npm run ingest
 */

import cron from "node-cron";
import { config } from "../../../shared/config.js";
import { createLogger } from "../../../shared/logger.js";
import { closePool } from "../../../shared/db/connection.js";
import { connectProducer, disconnectProducer } from "./producer.js";
import { pollOnce } from "./poller.js";

const log = createLogger("ingestion");

// ── Retry wrapper with exponential backoff ──────────────────
let isPolling = false;

async function safePoll() {
  // Prevent overlapping polls (if a poll takes longer than the interval)
  if (isPolling) {
    log.warn("previous poll still running, skipping this cycle");
    return;
  }

  isPolling = true;
  try {
    await pollOnce();
  } catch (err) {
    log.error({ err }, "unhandled error in poll cycle");
  } finally {
    isPolling = false;
  }
}

// ── Main ────────────────────────────────────────────────────
async function main() {
  log.info(
    { interval: config.pollIntervalSec, feed: config.usgsFeedUrl },
    "starting ingestion worker"
  );

  // Connect Kafka producer
  await connectProducer();

  // Run first poll immediately
  await safePoll();

  // Schedule recurring polls using cron
  // Convert interval seconds to a cron expression
  // For 60s → "* * * * *" (every minute)
  const intervalSec = config.pollIntervalSec;

  let cronExpression;
  if (intervalSec <= 59) {
    // For sub-minute, use setInterval instead (cron doesn't support < 1 min)
    log.info({ intervalSec }, "using setInterval for sub-minute polling");
    setInterval(safePoll, intervalSec * 1000);
  } else if (intervalSec === 60) {
    cronExpression = "* * * * *"; // every minute
  } else if (intervalSec % 60 === 0) {
    const mins = intervalSec / 60;
    cronExpression = `*/${mins} * * * *`; // every N minutes
  } else {
    // Fallback: setInterval for non-standard intervals
    log.info({ intervalSec }, "using setInterval for custom interval");
    setInterval(safePoll, intervalSec * 1000);
  }

  if (cronExpression) {
    cron.schedule(cronExpression, safePoll, {
      scheduled: true,
      timezone: "UTC",
    });
    log.info({ cronExpression }, "cron scheduled");
  }

  log.info("ingestion worker running — press Ctrl+C to stop");
}

// ── Graceful shutdown ───────────────────────────────────────
async function shutdown(signal) {
  log.info({ signal }, "shutting down ingestion worker");
  try {
    await disconnectProducer();
    await closePool();
  } catch (err) {
    log.error({ err }, "error during shutdown");
  }
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((err) => {
  log.fatal({ err }, "ingestion worker crashed");
  process.exit(1);
});
