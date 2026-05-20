/**
 * Swarm detection service.
 *
 * Detects spatial+temporal clusters of earthquakes near user locations.
 * A "swarm" = N+ events within R km over T hours.
 */

import prisma from "../../../../shared/db/client.js";
import { createLogger } from "../../../../shared/logger.js";

const log = createLogger("service:swarm");

const SWARM_WINDOW_HOURS = 0.5; // 30 minutes
const SWARM_RADIUS_KM = 200;
const SWARM_MIN_COUNT = 5;
const SWARM_MIN_MAG = 1.5; // only count events above this

/**
 * Check if a swarm exists near the given event coordinates.
 * Returns swarm data if threshold is met, null otherwise.
 *
 * @param {number} lon
 * @param {number} lat
 * @param {object} options
 * @param {string} [options.excludeEventId] - don't count the triggering event itself
 * @param {number} [options.radiusKm] - radius of swarm search in km
 * @param {number} [options.windowHours] - time window of swarm search in hours
 * @param {number} [options.minCount] - minimum event count to be considered a swarm
 * @param {number} [options.minMag] - minimum magnitude of events in swarm
 */
export async function detectSwarm(lon, lat, options = {}) {
  const {
    excludeEventId = null,
    radiusKm = SWARM_RADIUS_KM,
    windowHours = SWARM_WINDOW_HOURS,
    minCount = SWARM_MIN_COUNT,
    minMag = SWARM_MIN_MAG,
  } = options;

  try {
    const result = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "count",
        ROUND(AVG(mag)::numeric, 1)::float AS "avgMag",
        MAX(mag)::float AS "maxMag",
        MIN(event_time) AS "firstEvent",
        MAX(event_time) AS "lastEvent"
      FROM earthquakes
      WHERE ST_DWithin(
          geog,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          $3 * 1000
        )
        AND event_time > NOW() - INTERVAL '1 hour' * $4
        AND mag >= $5
        AND ($6::text IS NULL OR id != $6)
    `, lon, lat, radiusKm, windowHours, minMag, excludeEventId);

    const s = result[0];

    if (!s || s.count < minCount) return null;

    log.info(
      { count: s.count, avgMag: s.avgMag, maxMag: s.maxMag, lon, lat, radiusKm, windowHours },
      "swarm detected"
    );

    return {
      count: s.count,
      avgMag: s.avgMag,
      maxMag: s.maxMag,
      firstEvent: s.firstEvent,
      lastEvent: s.lastEvent,
      centerLon: lon,
      centerLat: lat,
      radiusKm,
      windowHours,
    };
  } catch (err) {
    log.error({ err, lon, lat, radiusKm, windowHours }, "swarm detection query failed");
    return null;
  }
}

export { SWARM_WINDOW_HOURS, SWARM_RADIUS_KM, SWARM_MIN_COUNT };
