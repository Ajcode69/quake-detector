/**
 * USGS Poller — fetches the hourly GeoJSON feed, upserts to Postgres,
 * produces to Kafka. Handles staleness detection and health recording.
 */

import { config } from "../../../shared/config.js";
import { createLogger } from "../../../shared/logger.js";
import { upsertEarthquake } from "./services/earthquake.service.js";
import { recordPollHealth } from "./services/health.service.js";
import { produceRawEvent, produceRevisions } from "./producer.js";

const log = createLogger("poller");

let lastGenerated = 0;
let consecutiveFailures = 0;
const MAX_FAILURES_BEFORE_ALERT = 5;

/**
 * Single poll cycle — fetch → parse → upsert → produce.
 */
export async function pollOnce() {
  const start = Date.now();
  let status = "success";
  let eventsFetched = 0;
  let newEvents = 0;
  let revisionCount = 0;
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
          await produceRawEvent(result.event);
        }

        if (result.revisions.length > 0) {
          revisionCount += result.revisions.length;
          await produceRawEvent(result.event);
          await produceRevisions(feature.id, result.revisions);
        }
      } catch (err) {
        log.error({ err, eventId: feature.id }, "failed to process event");
      }
    }

    consecutiveFailures = 0;
    log.info({ eventsFetched, newEvents, revisions: revisionCount, ms: Date.now() - start }, "poll cycle complete");
  } catch (err) {
    status = "error";
    errorMessage = err.message;
    consecutiveFailures++;

    log.error({ err, consecutiveFailures }, "poll cycle failed");

    if (consecutiveFailures >= MAX_FAILURES_BEFORE_ALERT) {
      log.fatal({ consecutiveFailures }, "SOURCE SILENCE — USGS unreachable");
    }
  }

  try {
    await recordPollHealth({ status, eventsFetched, newEvents, revisions: revisionCount, responseMs: Date.now() - start, errorMessage });
  } catch (err) {
    log.error({ err }, "failed to record poll health");
  }
}
