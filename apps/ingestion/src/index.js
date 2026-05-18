/**
 * Ingestion worker — entry point.
 * Polls USGS on a schedule with exponential backoff.
 * Sweeps kafkaPending events that failed Kafka produce.
 *
 * Usage: npm run ingest
 */

import { config } from "../../../shared/config.js";
import { createLogger } from "../../../shared/logger.js";
import prisma, { disconnect } from "../../../shared/db/client.js";
import { connectProducer, produceRawEvent, disconnectProducer } from "./producer.js";
import { pollOnce, getBackoffMs } from "./poller.js";

const log = createLogger("ingestion");

let isPolling = false;
let pollTimer = null;

async function safePoll() {
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
    // Schedule next poll with backoff
    schedulePoll();
  }
}

/**
 * Schedule the next poll using exponential backoff.
 * Replaces fixed cron with dynamic setTimeout.
 */
function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer);
  const nextMs = getBackoffMs();
  pollTimer = setTimeout(safePoll, nextMs);
  log.debug({ nextMs }, "next poll scheduled");
}

/**
 * Sweep: re-produce events that were written to Postgres but failed Kafka.
 * Runs every 2 minutes.
 */
async function kafkaPendingSweep() {
  try {
    const pending = await prisma.earthquake.findMany({
      where: { kafkaPending: true },
      take: 20,
      orderBy: { ingestedAt: "asc" },
    });

    if (pending.length === 0) return;

    log.info({ count: pending.length }, "sweeping kafkaPending events");

    for (const event of pending) {
      try {
        await produceRawEvent({
          id: event.id,
          mag: event.mag,
          place: event.place,
          sig: event.sig,
          tsunami: event.tsunami,
          depth: event.depth,
          alert: event.alert,
          longitude: event.longitude,
          latitude: event.latitude,
          time: event.eventTime?.getTime(),
        });

        await prisma.earthquake.update({
          where: { id: event.id },
          data: { kafkaPending: false },
        });

        log.info({ id: event.id }, "kafkaPending event re-produced");
      } catch (err) {
        log.error({ err, id: event.id }, "kafkaPending sweep failed for event");
      }
    }
  } catch (err) {
    log.error({ err }, "kafkaPending sweep error");
  }
}

async function main() {
  log.info({ interval: config.pollIntervalSec, feed: config.usgsFeedUrl }, "starting ingestion worker");

  await connectProducer();

  // Initial poll
  await safePoll();

  // Kafka pending sweep every 2 min
  setInterval(kafkaPendingSweep, 120_000);

  log.info("ingestion worker running — press Ctrl+C to stop");
}

async function shutdown(signal) {
  log.info({ signal }, "shutting down ingestion worker");
  if (pollTimer) clearTimeout(pollTimer);
  try {
    await disconnectProducer();
    await disconnect();
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
