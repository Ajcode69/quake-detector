import { config } from "../../../../shared/config.js";
import prisma from "../../../../shared/db/client.js";
import { createLogger } from "../../../../shared/logger.js";
import { upsertEarthquake } from "./earthquake.service.js";
import { calculateAllScores } from "../utils/scoring.js";

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

    const newFeatures = [];
    const updatedFeatures = [];

    // 3. Diff the Feed against our Database
    for (const feature of features) {
      const usgsUpdatedMs = feature.properties.updated || feature.properties.time;
      const dbUpdatedMs = dbState.get(feature.id);

      // SCENARIO 1: We already have it and it hasn't changed -> Skip
      if (dbUpdatedMs !== undefined && usgsUpdatedMs <= dbUpdatedMs) {
        skipped++;
        continue;
      }

      if (dbUpdatedMs === undefined) {
        newFeatures.push(feature);
      } else {
        updatedFeatures.push(feature);
      }
    }

    log.info({ new: newFeatures.length, updated: updatedFeatures.length, skipped }, "diff complete");

    // 4a. Bulk insert NEW events (Massively speeds up first-time backfills)
    if (newFeatures.length > 0) {
      const BATCH_SIZE = 5000;
      for (let i = 0; i < newFeatures.length; i += BATCH_SIZE) {
        const batch = newFeatures.slice(i, i + BATCH_SIZE);
        const mappedData = batch.map((feature) => {
          const p = feature.properties;
          const [lon, lat, depth] = feature.geometry.coordinates;
          const { confidenceScore, impactScore, eventClass } = calculateAllScores(p, depth);
          return {
            id: feature.id,
            mag: p.mag,
            magType: p.magType,
            place: p.place,
            eventTime: new Date(p.time),
            updatedAt: p.updated ? new Date(p.updated) : null,
            sig: p.sig,
            mmi: p.mmi,
            cdi: p.cdi,
            alert: p.alert,
            tsunami: p.tsunami ?? 0,
            felt: p.felt,
            depth,
            latitude: lat,
            longitude: lon,
            status: p.status,
            confidenceScore,
            impactScore,
            eventClass,
            net: p.net,
            code: p.code,
            ids: p.ids,
            sources: p.sources,
            types: p.types,
            nst: p.nst,
            dmin: p.dmin,
            rms: p.rms,
            gap: p.gap,
            eventType: p.type || "earthquake",
            url: p.url,
            detailUrl: p.detail,
          };
        });

        try {
          await prisma.earthquake.createMany({ data: mappedData, skipDuplicates: true });
          processed += batch.length;
        } catch (err) {
          log.error({ err, batchSize: batch.length }, "failed to bulk insert new events");
          errors += batch.length;
        }
      }

      // Bulk update geometries for the new inserts
      try {
        await prisma.$executeRaw`
          UPDATE earthquakes
          SET geog = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
          WHERE geog IS NULL
        `;
      } catch (err) {
        log.error({ err }, "failed to bulk update PostGIS geometries");
      }
    }

    // 4b. Async concurrently upsert UPDATED events (Handles revisions)
    if (updatedFeatures.length > 0) {
      const CONCURRENCY = 50;
      const retryBatch = [];

      for (let i = 0; i < updatedFeatures.length; i += CONCURRENCY) {
        const batch = updatedFeatures.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(feature => upsertEarthquake(feature, { notify: false }))
        );
        
        results.forEach((res, index) => {
          if (res.status === 'fulfilled') {
            processed++;
          } else {
            // Queue for retry
            retryBatch.push(batch[index]);
            log.warn({ err: res.reason, eventId: batch[index].id }, "failed to async upsert updated event, queuing for retry");
          }
        });
      }

      // One-time retry for any failed updates
      if (retryBatch.length > 0) {
        log.info({ retryCount: retryBatch.length }, "executing one-time retry for failed updated events");
        
        for (let i = 0; i < retryBatch.length; i += CONCURRENCY) {
          const batch = retryBatch.slice(i, i + CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map(feature => upsertEarthquake(feature, { notify: false }))
          );
          
          results.forEach((res, index) => {
            if (res.status === 'fulfilled') {
              processed++;
            } else {
              // Definitive failure
              errors++;
              log.error({ err: res.reason, eventId: batch[index].id }, "failed to async upsert updated event on retry");
            }
          });
        }
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
