/**
 * USGS Poller — fetches the hourly GeoJSON feed, upserts to Postgres,
 * produces to Kafka. Handles retries, staleness detection, and health recording.
 */

import { config } from "../../../shared/config.js";
import { createLogger } from "../../../shared/logger.js";
import { upsertEarthquake, recordPollHealth } from "../../../shared/db/queries.js";
import { produceRawEvent, produceRevisions } from "./producer.js";

const log = createLogger("poller");

// Track last successful metadata.generated to detect stale responses
let lastGenerated = 0;
let consecutiveFailures = 0;
const MAX_FAILURES_BEFORE_ALERT = 5;

/**
 * Single poll cycle — fetch → parse → upsert → produce.
 * Called by the scheduler every POLL_INTERVAL_SEC.
 */
export async function pollOnce() {
  const start = Date.now();
  let status = "success";
  let eventsFetched = 0;
  let newEvents = 0;
  let revisionCount = 0;
  let errorMessage = null;

  try {
    // ── 1. Fetch USGS feed ──────────────────────────────────
    const response = await fetch(config.usgsFeedUrl, {
      signal: AbortSignal.timeout(15_000), // 15s timeout
    });

    if (!response.ok) {
      throw new Error(`USGS returned HTTP ${response.status}`);
    }

    const data = await response.json();

    // ── 2. Validate response ────────────────────────────────
    if (data.metadata?.status !== 200) {
      throw new Error(`USGS metadata status: ${data.metadata?.status}`);
    }

    // ── 3. Staleness check ──────────────────────────────────
    if (data.metadata.generated <= lastGenerated) {
      log.debug(
        { generated: data.metadata.generated, lastGenerated },
        "feed is stale, skipping"
      );
      await recordPollHealth({
        status: "stale",
        eventsFetched: 0,
        newEvents: 0,
        revisions: 0,
        responseMs: Date.now() - start,
        errorMessage: null,
      });
      return;
    }

    lastGenerated = data.metadata.generated;
    eventsFetched = data.features?.length || 0;

    // ── 4. Process each event ───────────────────────────────
    for (const feature of data.features || []) {
      try {
        const result = await upsertEarthquake(feature);

        if (result.isNew) {
          newEvents++;
          await produceRawEvent(result.event);
        }

        if (result.revisions.length > 0) {
          revisionCount += result.revisions.length;
          // Produce the updated event to raw topic (consumers will see new version)
          await produceRawEvent(result.event);
          // Produce revision diffs to compacted topic
          await produceRevisions(feature.id, result.revisions);
        }
      } catch (err) {
        // Don't let one bad event kill the entire batch
        log.error({ err, eventId: feature.id }, "failed to process event");
      }
    }

    // Reset failure counter on success
    consecutiveFailures = 0;

    log.info(
      { eventsFetched, newEvents, revisions: revisionCount, ms: Date.now() - start },
      "poll cycle complete"
    );
  } catch (err) {
    status = "error";
    errorMessage = err.message;
    consecutiveFailures++;

    log.error(
      { err, consecutiveFailures },
      "poll cycle failed"
    );

    // TODO: After MAX_FAILURES_BEFORE_ALERT consecutive failures,
    // fire a Telegram alert to the ops channel (source silence detection).
    if (consecutiveFailures >= MAX_FAILURES_BEFORE_ALERT) {
      log.fatal(
        { consecutiveFailures },
        "SOURCE SILENCE — USGS unreachable for multiple consecutive polls"
      );
    }
  }

  // ── 5. Record poll health ─────────────────────────────────
  try {
    await recordPollHealth({
      status,
      eventsFetched,
      newEvents,
      revisions: revisionCount,
      responseMs: Date.now() - start,
      errorMessage,
    });
  } catch (err) {
    log.error({ err }, "failed to record poll health");
  }
}
