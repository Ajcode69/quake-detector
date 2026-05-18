/**
 * USGS Poller — fetches the GeoJSON feed, upserts to Postgres,
 * produces to Kafka. Handles staleness, backoff, source silence alerts.
 */

import { config } from "../../../shared/config.js";
import { createLogger } from "../../../shared/logger.js";
import prisma from "../../../shared/db/client.js";
import { upsertEarthquake } from "./services/earthquake.service.js";
import { recordPollHealth } from "./services/health.service.js";
import { produceRawEvent, produceRevisions } from "./producer.js";

const log = createLogger("poller");

let lastGenerated = 0;
let consecutiveFailures = 0;
let lastSuccessAt = Date.now();
const MAX_FAILURES_BEFORE_ALERT = 5;
let sourceSilenceAlerted = false; // prevent re-alerting every poll

/**
 * Get the next poll interval with exponential backoff on failures.
 * Normal: config.pollIntervalSec * 1000
 * Failing: min(interval * 2^failures, 10 minutes)
 */
export function getBackoffMs() {
  if (consecutiveFailures === 0) return config.pollIntervalSec * 1000;
  return Math.min(
    config.pollIntervalSec * 1000 * Math.pow(2, consecutiveFailures),
    600_000 // cap at 10 minutes
  );
}

/**
 * Single poll cycle — fetch → parse → upsert → produce → health.
 */
export async function pollOnce() {
  const start = Date.now();
  let status = "success";
  let eventsFetched = 0;
  let newEvents = 0;
  let revisionCount = 0;
  let kafkaFailures = 0;
  let errorMessage = null;

  try {
    const response = await fetch(config.usgsFeedUrl, {
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) throw new Error(`USGS returned HTTP ${response.status}`);

    const data = await response.json();

    if (data.metadata?.status !== 200) {
      throw new Error(`USGS metadata status: ${data.metadata?.status}`);
    }

    // Staleness check
    if (data.metadata.generated <= lastGenerated) {
      log.debug({ generated: data.metadata.generated }, "feed is stale, skipping");
      await recordPollHealth({ status: "stale", eventsFetched: 0, newEvents: 0, revisions: 0, responseMs: Date.now() - start, errorMessage: null });
      return;
    }

    lastGenerated = data.metadata.generated;
    eventsFetched = data.features?.length || 0;

    for (const feature of data.features || []) {
      try {
        const result = await upsertEarthquake(feature);

        if (result.isNew) {
          newEvents++;
          try {
            await produceRawEvent(result.event);
          } catch (kafkaErr) {
            kafkaFailures++;
            log.error({ kafkaErr, eventId: feature.id }, "Kafka produce failed — marking for retry");
            // Mark in DB for Kafka sweep to pick up later
            await prisma.earthquake.update({
              where: { id: feature.id },
              data: { kafkaPending: true },
            }).catch(() => {}); // best-effort
          }
        }

        if (result.revisions.length > 0) {
          revisionCount += result.revisions.length;
          try {
            await produceRawEvent(result.event);
            await produceRevisions(feature.id, result.revisions);
          } catch (kafkaErr) {
            kafkaFailures++;
            log.error({ kafkaErr, eventId: feature.id }, "Kafka revision produce failed");
            await prisma.earthquake.update({
              where: { id: feature.id },
              data: { kafkaPending: true },
            }).catch(() => {});
          }
        }
      } catch (err) {
        log.error({ err, eventId: feature.id }, "failed to process event");
      }
    }

    consecutiveFailures = 0;
    lastSuccessAt = Date.now();
    sourceSilenceAlerted = false;

    if (kafkaFailures > 0) {
      log.warn({ kafkaFailures, total: eventsFetched }, "some events failed Kafka produce — marked as kafkaPending");
    }

    log.info({ eventsFetched, newEvents, revisions: revisionCount, kafkaFailures, ms: Date.now() - start }, "poll cycle complete");
  } catch (err) {
    status = "error";
    errorMessage = err.message;
    consecutiveFailures++;

    log.error({ err, consecutiveFailures, backoffMs: getBackoffMs() }, "poll cycle failed");

    // Source silence detection — alert all users via Kafka
    if (consecutiveFailures >= MAX_FAILURES_BEFORE_ALERT && !sourceSilenceAlerted) {
      sourceSilenceAlerted = true;
      try {
        await produceRawEvent({
          id: `system:source_silence:${Date.now()}`,
          _systemAlert: true,
          alertType: "source_silence",
          consecutiveFailures,
          lastSuccessAt,
          place: "System — USGS Source Silence",
        });
        log.fatal({ consecutiveFailures }, "SOURCE SILENCE alert produced");
      } catch (alertErr) {
        log.error({ alertErr }, "failed to produce source silence alert");
      }
    }
  }

  try {
    await recordPollHealth({ status, eventsFetched, newEvents, revisions: revisionCount, responseMs: Date.now() - start, errorMessage });
  } catch (err) {
    log.error({ err }, "failed to record poll health");
  }
}
