/**
 * Backfill — one-time import of the USGS monthly feed.
 * Checkpoint-based, resumable, idempotent.
 *
 * Usage:  npm run backfill
 */

import { config } from "../../../shared/config.js";
import { createLogger } from "../../../shared/logger.js";
import { upsertEarthquake, getCheckpoint, setCheckpoint } from "../../../shared/db/queries.js";
import { connectProducer, produceRawEvent, disconnectProducer } from "./producer.js";
import { closePool } from "../../../shared/db/connection.js";

const log = createLogger("backfill");
const CHECKPOINT_KEY = "backfill_last_event_time";
const BATCH_LOG_INTERVAL = 100;

async function main() {
  log.info({ url: config.usgsBackfillUrl }, "starting backfill");

  await connectProducer();

  try {
    // ── 1. Fetch monthly feed ─────────────────────────────
    const response = await fetch(config.usgsBackfillUrl, {
      signal: AbortSignal.timeout(60_000), // 60s — monthly feed is large
    });

    if (!response.ok) {
      throw new Error(`USGS returned HTTP ${response.status}`);
    }

    const data = await response.json();
    const features = data.features || [];

    log.info({ totalEvents: features.length }, "feed fetched");

    // ── 2. Sort by time (oldest first for ordered backfill) ─
    features.sort((a, b) => a.properties.time - b.properties.time);

    // ── 3. Resume from checkpoint ───────────────────────────
    const lastCheckpoint = await getCheckpoint(CHECKPOINT_KEY);
    const lastTime = lastCheckpoint ? parseInt(lastCheckpoint, 10) : 0;

    let processed = 0;
    let skipped = 0;

    for (const feature of features) {
      const eventTime = feature.properties.time;

      // Skip events we already processed
      if (eventTime <= lastTime) {
        skipped++;
        continue;
      }

      try {
        const result = await upsertEarthquake(feature);

        // Produce to Kafka even for backfill — populates the raw topic for consumers
        // But do NOT trigger real-time alerts (consumers can check the timestamp)
        if (result.isNew) {
          await produceRawEvent({ ...result.event, _backfill: true });
        }

        processed++;

        // Checkpoint every BATCH_LOG_INTERVAL events
        if (processed % BATCH_LOG_INTERVAL === 0) {
          await setCheckpoint(CHECKPOINT_KEY, String(eventTime));
          log.info({ processed, skipped, total: features.length }, "backfill progress");
        }
      } catch (err) {
        log.error({ err, eventId: feature.id }, "failed to process event during backfill");
        // Continue — don't let one bad event stop the backfill
      }
    }

    // Final checkpoint
    if (features.length > 0) {
      const lastEvent = features[features.length - 1];
      await setCheckpoint(CHECKPOINT_KEY, String(lastEvent.properties.time));
    }

    log.info({ processed, skipped, total: features.length }, "backfill complete");
  } finally {
    await disconnectProducer();
    await closePool();
  }
}

main().catch((err) => {
  log.fatal({ err }, "backfill crashed");
  process.exit(1);
});
