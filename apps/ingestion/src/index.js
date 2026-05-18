import { config } from "../../../shared/config.js";
import { createLogger } from "../../../shared/logger.js";
import prisma, { disconnect } from "../../../shared/db/client.js";
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

async function main() {
  log.info({ interval: config.pollIntervalSec, feed: config.usgsFeedUrl }, "starting ingestion worker");

  // Initial poll
  await safePoll();

  log.info("ingestion worker running — press Ctrl+C to stop");
}

async function shutdown(signal) {
  log.info({ signal }, "shutting down ingestion worker");
  if (pollTimer) clearTimeout(pollTimer);
  try {
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
