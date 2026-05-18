import cron from "node-cron";
import { config } from "../../../shared/config.js";
import { createLogger } from "../../../shared/logger.js";
import { disconnect } from "../../../shared/db/client.js";
import { connectProducer, disconnectProducer } from "./producer.js";
import { pollOnce } from "./poller.js";

const log = createLogger("ingestion");

let isPolling = false;

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
  }
}

async function main() {
  log.info({ interval: config.pollIntervalSec, feed: config.usgsFeedUrl }, "starting ingestion worker");

  await connectProducer();
  await safePoll();

  const intervalSec = config.pollIntervalSec;
  let cronExpression;

  if (intervalSec <= 59) {
    log.info({ intervalSec }, "using setInterval for sub-minute polling");
    setInterval(safePoll, intervalSec * 1000);
  } else if (intervalSec === 60) {
    cronExpression = "* * * * *";
  } else if (intervalSec % 60 === 0) {
    const mins = intervalSec / 60;
    cronExpression = `*/${mins} * * * *`;
  } else {
    log.info({ intervalSec }, "using setInterval for custom interval");
    setInterval(safePoll, intervalSec * 1000);
  }

  if (cronExpression) {
    cron.schedule(cronExpression, safePoll, { scheduled: true, timezone: "UTC" });
    log.info({ cronExpression }, "cron scheduled");
  }

  log.info("ingestion worker running — press Ctrl+C to stop");
}

async function shutdown(signal) {
  log.info({ signal }, "shutting down ingestion worker");
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
