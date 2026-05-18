import { config } from "../../../../shared/config.js";
import prisma from "../../../../shared/db/client.js";
import { createLogger } from "../../../../shared/logger.js";
import { upsertEarthquake } from "./earthquake.service.js";
const log = createLogger("reconciliation");

export async function runReconciliation() {
  const logEntry = await prisma.backfillLog.create({
    data: { status: 'running' }
  });

  log.info("starting reconciliation");

  try {
    // 1. Fetch the 30-day feed
    const response = await fetch(config.usgsBackfillUrl, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`USGS returned HTTP ${response.status}`);
    
    const data = await response.json();
    const features = data.features || [];
    
    // 2. Fetch current DB state (just ID and updatedAt) for fast memory comparison
    // We fetch events from the last 35 days to ensure full coverage of the 30-day feed
    const thirtyFiveDaysAgo = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    const dbEventsRaw = await prisma.earthquake.findMany({
      where: { eventTime: { gte: thirtyFiveDaysAgo } },
      select: { id: true, updatedAt: true, eventTime: true }
    });

    // Build a map of id -> last updated timestamp (in ms)
    const dbState = new Map();
    for (const row of dbEventsRaw) {
      // If USGS never provided an 'updated' time, fallback to 'eventTime'
      const dbUpdatedMs = row.updatedAt ? row.updatedAt.getTime() : row.eventTime.getTime();
      dbState.set(row.id, dbUpdatedMs);
    }

    let processed = 0;
    let skipped = 0;
    let errors = 0;

    // 3. Diff the Feed against our Database
    for (const feature of features) {
      const usgsUpdatedMs = feature.properties.updated || feature.properties.time;
      
      const dbUpdatedMs = dbState.get(feature.id);

      // SCENARIO 1: We already have it and it hasn't changed -> Skip
      if (dbUpdatedMs !== undefined && usgsUpdatedMs <= dbUpdatedMs) {
        skipped++;
        continue;
      }

      // SCENARIO 2: Brand new database OR a "lost event" that the poller missed (dbUpdatedMs === undefined)
      // SCENARIO 3: A revision, where USGS updated it recently (usgsUpdatedMs > dbUpdatedMs)
      try {
        await upsertEarthquake(feature, { notify: false });
        processed++;
      } catch (err) {
        log.error({ err, eventId: feature.id }, "failed to reconcile event");
        errors++;
      }
    }

    const status = errors > 0 ? (processed === 0 ? 'failed' : 'partial_success') : 'success';

    await prisma.backfillLog.update({
      where: { id: logEntry.id },
      data: {
        status,
        completedAt: new Date(),
        eventsTotal: features.length,
        eventsUpserted: processed,
        errorsCount: errors,
      }
    });

    log.info({ processed, skipped, errors }, "reconciliation complete");
  } catch (err) {
    log.error({ err }, "reconciliation failed fatally");
    await prisma.backfillLog.update({
      where: { id: logEntry.id },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: err.message
      }
    });
  }
}
