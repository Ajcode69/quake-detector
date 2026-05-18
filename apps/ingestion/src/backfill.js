/**
 * Backfill — one-time import of the USGS monthly feed.
 * Checkpoint-based, resumable, idempotent.
 *
 * Usage:  npm run backfill
 */

import { config } from "../../../shared/config.js";
import { createLogger } from "../../../shared/logger.js";
import { upsertEarthquake } from "./services/earthquake.service.js";
import { getCheckpoint, setCheckpoint } from "./services/health.service.js";
import { connectProducer, produceRawEvent, disconnectProducer } from "./producer.js";
import { disconnect } from "../../../shared/db/client.js";

const log = createLogger("backfill");
const CHECKPOINT_KEY = "backfill_last_event_time";

async function main() {
  log.info({ url: config.usgsBackfillUrl }, "starting backfill");

  await connectProducer();

  try {
    const response = await fetch(config.usgsBackfillUrl, {
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) throw new Error(`USGS returned HTTP ${response.status}`);

    const data = await response.json();
    const features = data.features || [];

    log.info({ totalEvents: features.length }, "feed fetched");

    features.sort((a, b) => a.properties.time - b.properties.time);

    const lastCheckpoint = await getCheckpoint(CHECKPOINT_KEY);
    const lastTime = lastCheckpoint ? parseInt(lastCheckpoint, 10) : 0;

    let processed = 0;
    let skipped = 0;

    for (const feature of features) {
      const eventTime = feature.properties.time;
      if (eventTime <= lastTime) { skipped++; continue; }

      try {
        const result = await upsertEarthquake(feature);
        if (result.isNew) {
          await produceRawEvent({ ...result.event, _backfill: true });
        }
        processed++;

        if (processed % 100 === 0) {
          await setCheckpoint(CHECKPOINT_KEY, String(eventTime));
          log.info({ processed, skipped, total: features.length }, "backfill progress");
        }
      } catch (err) {
        log.error({ err, eventId: feature.id }, "failed to process event during backfill");
      }
    }

    if (features.length > 0) {
      await setCheckpoint(CHECKPOINT_KEY, String(features[features.length - 1].properties.time));
    }

    log.info({ processed, skipped, total: features.length }, "backfill complete");
  } finally {
    await disconnectProducer();
    await disconnect();
  }
}

main().catch((err) => {
  log.fatal({ err }, "backfill crashed");
  process.exit(1);
});
