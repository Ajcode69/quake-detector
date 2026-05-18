/**
 * Swarm detection service.
 *
 * Detects spatial+temporal clusters of earthquakes near user locations.
 * A "swarm" = N+ events within R km over T hours.
 */

import prisma from "../../../../shared/db/client.js";
import { createLogger } from "../../../../shared/logger.js";

const log = createLogger("service:swarm");

const SWARM_WINDOW_HOURS = 6;
const SWARM_RADIUS_KM = 50;
const SWARM_MIN_COUNT = 5;
const SWARM_MIN_MAG = 1.5; // only count events above this

/**
 * Check if a swarm exists near the given event coordinates.
 * Returns swarm data if threshold is met, null otherwise.
 *
 * @param {number} lon
 * @param {number} lat
 * @param {string} excludeEventId - don't count the triggering event itself
 */
export async function detectSwarm(lon, lat, excludeEventId) {
  try {
    const result = await prisma.$queryRaw`
      SELECT
        COUNT(*)::int AS "count",
        ROUND(AVG(mag)::numeric, 1)::float AS "avgMag",
        MAX(mag)::float AS "maxMag",
        MIN(event_time) AS "firstEvent",
        MAX(event_time) AS "lastEvent"
      FROM earthquakes
      WHERE ST_DWithin(
          geog,
          ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography,
          ${SWARM_RADIUS_KM * 1000}
        )
        AND event_time > NOW() - INTERVAL '1 hour' * ${SWARM_WINDOW_HOURS}
        AND mag >= ${SWARM_MIN_MAG}
        AND id != ${excludeEventId}
    `;

    const s = result[0];

    if (!s || s.count < SWARM_MIN_COUNT) return null;

    log.info(
      { count: s.count, avgMag: s.avgMag, maxMag: s.maxMag, lon, lat },
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
      radiusKm: SWARM_RADIUS_KM,
      windowHours: SWARM_WINDOW_HOURS,
    };
  } catch (err) {
    log.error({ err, lon, lat }, "swarm detection query failed");
    return null;
  }
}

export { SWARM_WINDOW_HOURS, SWARM_RADIUS_KM, SWARM_MIN_COUNT };
