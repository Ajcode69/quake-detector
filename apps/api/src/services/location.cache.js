/**
 * Location queries — direct PostGIS lookups with in-memory fallback.
 *
 * Primary path:  PostGIS ST_DWithin (exact, always fresh)
 * Fallback path: In-memory array + haversine (when Postgres is unreachable)
 *
 * The fallback cache refreshes every 60s from Postgres. With ~3 locations,
 * no spatial index is needed — a simple array + haversine loop is fine.
 */

import prisma from "../../../../shared/db/client.js";
import { createLogger } from "../../../../shared/logger.js";

const log = createLogger("locations");

// ── Fallback cache ──────────────────────────────────────────
let cachedLocations = [];
let cachedChatIds = [];
let lastRefresh = 0;
const REFRESH_INTERVAL_MS = 60_000;
let refreshTimer = null;

/**
 * Refresh the fallback cache from Postgres.
 */
async function refreshCache() {
  try {
    const rows = await prisma.userLocation.findMany({
      select: {
        id: true, label: true, latitude: true, longitude: true,
        radiusKm: true, telegramChatId: true,
      },
    });
    cachedLocations = rows;
    const chatIdSet = new Set(rows.map((r) => r.telegramChatId));
    cachedChatIds = [...chatIdSet];
    lastRefresh = Date.now();
    log.debug({ count: rows.length }, "location fallback cache refreshed");
  } catch (err) {
    log.error({ err }, "location cache refresh failed — keeping stale data");
  }
}

/**
 * Start the periodic fallback cache refresh.
 */
export async function startLocationCache() {
  await refreshCache();
  refreshTimer = setInterval(refreshCache, REFRESH_INTERVAL_MS);
  log.info("location fallback cache started");
}

/**
 * Stop the cache refresh loop.
 */
export function stopLocationCache() {
  if (refreshTimer) clearInterval(refreshTimer);
}

/**
 * Force-refresh cache immediately (call after add/remove).
 */
export async function invalidateLocationCache() {
  await refreshCache();
}

// ── Haversine (for fallback path only) ──────────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Find user locations near an earthquake.
 * Primary:  PostGIS (exact, fresh)
 * Fallback: In-memory haversine (when Postgres is down)
 */
export async function findNearbyLocations(eventLon, eventLat) {
  // ── Primary path: PostGIS ─────────────────────────────────
  try {
    const rows = await prisma.$queryRaw`
      SELECT 
        id, label, latitude, longitude, radius_km AS "radiusKm",
        telegram_chat_id AS "telegramChatId",
        ST_Distance(geog, ST_SetSRID(ST_MakePoint(${eventLon}, ${eventLat}), 4326)::geography) / 1000.0 AS distance_km
      FROM user_locations
      WHERE ST_DWithin(
        geog,
        ST_SetSRID(ST_MakePoint(${eventLon}, ${eventLat}), 4326)::geography,
        radius_km * 1000
      )
      ORDER BY distance_km ASC
    `;
    return rows.map((r) => ({
      ...r,
      telegramChatId: r.telegramChatId,
      distanceKm: Math.round(Number(r.distance_km)),
    }));
  } catch (err) {
    log.warn({ err }, "PostGIS query failed — falling back to in-memory cache");
  }

  // ── Fallback: in-memory haversine ─────────────────────────
  if (cachedLocations.length === 0) return [];

  const results = [];
  for (const loc of cachedLocations) {
    const distKm = haversineKm(eventLat, eventLon, loc.latitude, loc.longitude);
    if (distKm <= loc.radiusKm) {
      results.push({
        id: loc.id,
        label: loc.label,
        latitude: loc.latitude,
        longitude: loc.longitude,
        radiusKm: loc.radiusKm,
        telegramChatId: loc.telegramChatId,
        distanceKm: Math.round(distKm),
      });
    }
  }
  return results.sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Get all distinct chat IDs.
 * Primary:  Postgres
 * Fallback: In-memory cache
 */
export async function getAllChatIds() {
  try {
    const rows = await prisma.$queryRaw`
      SELECT DISTINCT telegram_chat_id AS "telegramChatId"
      FROM user_locations
    `;
    return rows.map((r) => r.telegramChatId);
  } catch (err) {
    log.warn({ err }, "chat ID query failed — using cached data");
    return cachedChatIds;
  }
}
