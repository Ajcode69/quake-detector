/**
 * Parameterized PostGIS spatial queries for the earthquakes table.
 * Safer and more reliable than asking the LLM to write raw ST_DWithin SQL.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import prisma from "../../../../../shared/db/client.js";
import { createLogger } from "../../../../../shared/logger.js";

const log = createLogger("agent:postgis-query");

const QUERY_TIMEOUT_MS = 5000;
const MAX_LIMIT = 50;
const MAX_RADIUS_KM = 2000;
const DEFAULT_SINCE_HOURS = 168;
const DEFAULT_LIMIT = 20;

function serializeRows(rows) {
  return JSON.parse(
    JSON.stringify(rows, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );
}

async function withTimeout(queryPromise) {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("Query timeout (5s)")), QUERY_TIMEOUT_MS)
  );
  return Promise.race([queryPromise, timeoutPromise]);
}

function clampLimit(limit) {
  return Math.min(Math.max(1, limit ?? DEFAULT_LIMIT), MAX_LIMIT);
}

function clampRadius(radiusKm) {
  if (radiusKm == null) return null;
  return Math.min(Math.max(1, radiusKm), MAX_RADIUS_KM);
}

function sinceIso(hours) {
  const h = Math.min(Math.max(1, hours ?? DEFAULT_SINCE_HOURS), 8760);
  return new Date(Date.now() - h * 3600_000).toISOString();
}

async function resolveLocationPoint({ locationId, userId, radiusKmOverride }) {
  const location = await prisma.userLocation.findFirst({
    where: {
      id: locationId,
      ...(userId != null ? { userId } : {}),
    },
    select: {
      id: true,
      label: true,
      latitude: true,
      longitude: true,
      radiusKm: true,
    },
  });

  if (!location) {
    return { error: `Location ${locationId} not found${userId != null ? ` for user ${userId}` : ""}` };
  }

  return {
    latitude: location.latitude,
    longitude: location.longitude,
    radiusKm: clampRadius(radiusKmOverride ?? location.radiusKm),
    locationLabel: location.label,
  };
}

async function queryEventsNearPoint({ longitude, latitude, radiusKm, minMag, sinceIso, limit }) {
  const params = [longitude, latitude, radiusKm * 1000, sinceIso, limit];
  let paramIdx = 6;
  const magClause = minMag != null ? `AND e.mag >= $${paramIdx++}` : "";
  if (minMag != null) params.push(minMag);

  const sql = `
    SELECT
      e.id, e.mag, e.mag_type AS "magType", e.place, e.event_time AS "eventTime",
      e.sig, e.alert, e.tsunami, e.depth, e.latitude, e.longitude, e.status,
      ST_Distance(e.geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0 AS "distanceKm"
    FROM earthquakes e
    WHERE e.geog IS NOT NULL
      AND ST_DWithin(
        e.geog,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        $3
      )
      AND e.event_time >= $4::timestamptz
      ${magClause}
    ORDER BY e.event_time DESC
    LIMIT $5
  `;

  return prisma.$queryRawUnsafe(sql, ...params);
}

async function queryStatsNearPoint({ longitude, latitude, radiusKm, minMag, sinceIso }) {
  const params = [longitude, latitude, radiusKm * 1000, sinceIso];
  let paramIdx = 5;
  const magClause = minMag != null ? `AND e.mag >= $${paramIdx++}` : "";
  if (minMag != null) params.push(minMag);

  const sql = `
    SELECT
      COUNT(*)::int AS "totalEvents",
      COUNT(CASE WHEN e.event_time > NOW() - INTERVAL '24 hours' THEN 1 END)::int AS "count24h",
      COUNT(CASE WHEN e.event_time > NOW() - INTERVAL '7 days' THEN 1 END)::int AS "count7d",
      COALESCE(MAX(e.mag), 0)::float AS "maxMag",
      COALESCE(MAX(CASE WHEN e.event_time > NOW() - INTERVAL '24 hours' THEN e.mag END), 0)::float AS "maxMag24h",
      COALESCE(ROUND(AVG(e.depth)::numeric, 1), 0)::float AS "avgDepthKm",
      COUNT(CASE WHEN ST_Distance(e.geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0 <= 100
                  AND e.event_time >= $4::timestamptz THEN 1 END)::int AS "within100km",
      COUNT(CASE WHEN ST_Distance(e.geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0 <= 500
                  AND e.event_time >= $4::timestamptz THEN 1 END)::int AS "within500km"
    FROM earthquakes e
    WHERE e.geog IS NOT NULL
      AND ST_DWithin(
        e.geog,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        $3
      )
      AND e.event_time >= $4::timestamptz
      ${magClause}
  `;

  return prisma.$queryRawUnsafe(sql, ...params);
}

export const postgisQueryTool = tool(
  async ({
    queryType,
    purpose,
    latitude,
    longitude,
    locationId,
    userId,
    radiusKm,
    minMag,
    sinceHours,
    limit,
  }) => {
    log.info({ queryType, purpose, locationId, radiusKm }, "postgis query started");

    const isLocationQuery = queryType === "near_location" || queryType === "stats_near_location";
    const isPointQuery = queryType === "near_point" || queryType === "stats_near_point";

    let point = { latitude, longitude, radiusKm: clampRadius(radiusKm) };

    if (isLocationQuery) {
      if (locationId == null) {
        return JSON.stringify({ error: "locationId is required for location-based queries" });
      }
      const resolved = await resolveLocationPoint({ locationId, userId, radiusKmOverride: radiusKm });
      if (resolved.error) return JSON.stringify({ error: resolved.error });
      point = resolved;
    } else if (isPointQuery) {
      if (latitude == null || longitude == null || point.radiusKm == null) {
        return JSON.stringify({
          error: "latitude, longitude, and radiusKm are required for point-based queries",
        });
      }
    } else {
      return JSON.stringify({ error: `Unknown queryType: ${queryType}` });
    }

    const since = sinceIso(sinceHours);
    const rowLimit = clampLimit(limit);
    const start = Date.now();

    try {
      let rows;
      let meta = {
        queryType,
        latitude: point.latitude,
        longitude: point.longitude,
        radiusKm: point.radiusKm,
        sinceHours: sinceHours ?? DEFAULT_SINCE_HOURS,
        locationLabel: point.locationLabel ?? null,
      };

      if (queryType === "near_point" || queryType === "near_location") {
        rows = await withTimeout(
          queryEventsNearPoint({
            longitude: point.longitude,
            latitude: point.latitude,
            radiusKm: point.radiusKm,
            minMag,
            sinceIso: since,
            limit: rowLimit,
          })
        );
        meta.rowCount = Array.isArray(rows) ? rows.length : 0;
      } else {
        const stats = await withTimeout(
          queryStatsNearPoint({
            longitude: point.longitude,
            latitude: point.latitude,
            radiusKm: point.radiusKm,
            minMag,
            sinceIso: since,
          })
        );
        rows = stats;
        meta = { ...meta, stats: serializeRows(stats)[0] ?? {} };
      }

      const serialized = serializeRows(rows);
      log.info(
        {
          queryType,
          purpose,
          rowCount: Array.isArray(serialized) ? serialized.length : 1,
          durationMs: Date.now() - start,
        },
        "postgis query done"
      );

      return JSON.stringify({ ...meta, rows: serialized });
    } catch (err) {
      log.warn({ err, queryType, purpose }, "postgis query failed");
      return JSON.stringify({ error: "Spatial query failed. Check coordinates and radius." });
    }
  },
  {
    name: "postgis_query",
    description: `Run PostGIS spatial queries on the earthquakes table using the indexed geog column (geography Point, SRID 4326).

Use this tool (not db_query) for distance, radius, proximity, "near", "within X km", or "around my location" questions.

Query types:
- near_point: List earthquakes within radiusKm of latitude/longitude
- near_location: List earthquakes within a monitored user_locations row (by locationId)
- stats_near_point: Counts and max magnitude near latitude/longitude
- stats_near_location: Counts and max magnitude near a monitored location

Uses ST_DWithin and ST_Distance for accurate km distances. Default lookback is 7 days.`,
    schema: z.object({
      queryType: z
        .enum(["near_point", "near_location", "stats_near_point", "stats_near_location"])
        .describe("Spatial query pattern to run"),
      purpose: z.string().describe("Brief description of why this spatial query is needed"),
      latitude: z.number().min(-90).max(90).optional().describe("Center latitude for point queries"),
      longitude: z.number().min(-180).max(180).optional().describe("Center longitude for point queries"),
      locationId: z.number().int().optional().describe("user_locations.id for location-based queries"),
      userId: z.number().int().optional().describe("Scope location lookup to this user when using locationId"),
      radiusKm: z
        .number()
        .positive()
        .max(MAX_RADIUS_KM)
        .optional()
        .describe("Search radius in km (required for point queries; optional override for location queries)"),
      minMag: z.number().optional().describe("Minimum magnitude filter"),
      sinceHours: z
        .number()
        .positive()
        .max(8760)
        .optional()
        .describe("Lookback window in hours (default 168 = 7 days)"),
      limit: z.number().int().positive().max(MAX_LIMIT).optional().describe("Max rows for near_* queries (default 20, max 50)"),
    }),
  }
);
