/**
 * Location cache — in-memory cache of user locations for the evaluator.
 *
 * Why: The evaluator needs user locations to determine WHO to alert.
 * Without this cache, every event triggers a Postgres query. With it,
 * the evaluator can run alerts even if Postgres is momentarily slow,
 * and critical Kafka-first events get evaluated without waiting for DB.
 *
 * Refresh interval: 60 seconds (locations rarely change).
 */

import prisma from "../../../../shared/db/client.js";
import { createLogger } from "../../../../shared/logger.js";
import RBush from "rbush";

const log = createLogger("cache:locations");

let tree = new RBush(); // Spatial index
let allChatIds = [];    // distinct chat IDs
let lastRefresh = 0;
const REFRESH_INTERVAL_MS = 60_000;
let refreshTimer = null;

/**
 * Haversine distance in km — used for proximity matching against the cache.
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Refresh the cache from Postgres.
 */
async function refresh() {
  try {
    const rows = await prisma.userLocation.findMany({
      select: {
        id: true,
        label: true,
        latitude: true,
        longitude: true,
        radiusKm: true,
        telegramChatId: true,
      },
    });

    // Rebuild spatial tree
    const newTree = new RBush();
    const items = rows.map((r) => {
      // 1 degree latitude is ~111km. Longitude varies by cos(lat)
      const latDelta = r.radiusKm / 111;
      const lonDelta = r.radiusKm / (111 * Math.cos(toRad(r.latitude)));

      return {
        minX: r.longitude - lonDelta,
        minY: r.latitude - latDelta,
        maxX: r.longitude + lonDelta,
        maxY: r.latitude + latDelta,
        loc: {
          id: r.id,
          label: r.label,
          lat: r.latitude,
          lon: r.longitude,
          radiusKm: r.radiusKm,
          telegramChatId: r.telegramChatId,
        }
      };
    });
    newTree.load(items);
    tree = newTree;

    const chatIdSet = new Set(rows.map((r) => r.telegramChatId));
    allChatIds = [...chatIdSet];

    lastRefresh = Date.now();
    log.debug({ locationCount: items.length, chatIds: allChatIds.length }, "location cache refreshed");
  } catch (err) {
    log.error({ err }, "location cache refresh failed — using stale data");
    // Keep using stale cache — better than no cache
  }
}

/**
 * Start the cache refresh loop.
 */
export async function startLocationCache() {
  await refresh(); // initial load
  refreshTimer = setInterval(refresh, REFRESH_INTERVAL_MS);
  log.info("location cache started with rbush spatial index");
}

/**
 * Stop the cache refresh loop.
 */
export function stopLocationCache() {
  if (refreshTimer) clearInterval(refreshTimer);
}

/**
 * Find cached locations within range of an event.
 * Uses haversine (no DB call). Returns results compatible with PostGIS query shape.
 */
export async function findNearbyLocationsCached(eventLon, eventLat) {
  const results = [];

  // Fallback to Postgres if cache is empty or older than 2 minutes
  if (lastRefresh === 0 || Date.now() - lastRefresh > 120_000) {
    log.warn("Location cache empty or stale — falling back to Postgres spatial query");
    try {
      const rows = await prisma.$queryRaw`
        SELECT 
          id, label, latitude, longitude, radius_km AS "radiusKm", telegram_chat_id AS "telegramChatId",
          ST_Distance(geog, ST_SetSRID(ST_MakePoint(${eventLon}, ${eventLat}), 4326)::geography) / 1000.0 AS distance_km
        FROM user_locations
        WHERE ST_DWithin(geog, ST_SetSRID(ST_MakePoint(${eventLon}, ${eventLat}), 4326)::geography, radius_km * 1000)
      `;
      return rows.map(r => ({ ...r, distanceKm: Math.round(r.distance_km) }));
    } catch (err) {
      log.error({ err }, "Postgres fallback failed");
      return [];
    }
  }

  // Fast path: Spatial tree lookup
  const candidates = tree.search({
    minX: eventLon,
    minY: eventLat,
    maxX: eventLon,
    maxY: eventLat,
  });

  // Exact haversine filter (since tree uses bounding box squares)
  for (const item of candidates) {
    const loc = item.loc;
    const distKm = haversineKm(eventLat, eventLon, loc.lat, loc.lon);
    if (distKm <= loc.radiusKm) {
      results.push({
        id: loc.id,
        label: loc.label,
        latitude: loc.lat,
        longitude: loc.lon,
        radiusKm: loc.radiusKm,
        telegramChatId: loc.telegramChatId,
        distanceKm: Math.round(distKm),
      });
    }
  }

  return results.sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Get all distinct chat IDs from cache.
 */
export function getAllChatIdsCached() {
  return allChatIds;
}
