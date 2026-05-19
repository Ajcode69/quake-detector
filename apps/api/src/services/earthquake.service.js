/**
 * Earthquake read service for the API.
 * Handles event listing, filtering, and spatial queries.
 */

import prisma from "../../../../shared/db/client.js";

/**
 * Get paginated events with optional filters.
 * @param {{ limit?, offset?, minMag?, since?, locationIds? }} opts
 */
export async function getEvents({ limit = 50, offset = 0, minMag, since, locationIds, alertLevel, region, orderBy, eventClass } = {}) {
  // If locationIds provided, use spatial query to get events near those locations
  if (locationIds && locationIds.length > 0) {
    return getEventsNearLocations({ locationIds, limit, offset, minMag, since, alertLevel, region, orderBy, eventClass });
  }

  // Standard query — no spatial filter
  const where = {};
  if (minMag != null) where.mag = { gte: parseFloat(minMag) };
  if (since) where.eventTime = { gte: new Date(since) };
  if (alertLevel) where.alert = alertLevel;
  if (region) where.place = { contains: region, mode: "insensitive" };
  if (eventClass) where.eventClass = eventClass;

  let orderByObj = { eventTime: "desc" };
  if (orderBy === "mag") orderByObj = { mag: "desc" };
  else if (orderBy === "sig") orderByObj = { sig: "desc" };
  else if (orderBy === "depth") orderByObj = { depth: "desc" };

  const [events, totalCount] = await Promise.all([
    prisma.earthquake.findMany({
      where,
      orderBy: orderByObj,
      take: Math.min(limit, 200),
      skip: offset,
      select: {
        id: true, mag: true, magType: true, place: true, eventTime: true,
        sig: true, mmi: true, alert: true, tsunami: true, felt: true,
        depth: true, latitude: true, longitude: true, status: true,
        net: true, url: true, ingestedAt: true,
        eventClass: true, confidenceScore: true, impactScore: true,
      },
    }),
    prisma.earthquake.count({ where }),
  ]);

  return { events, totalCount };
}

/**
 * Get events near a set of user locations using PostGIS.
 * Returns events within any of the given locations' radii.
 */
async function getEventsNearLocations({ locationIds, limit = 50, offset = 0, minMag, since, alertLevel, region, orderBy, eventClass }) {
  // Build dynamic conditions
  const magCondition = minMag != null ? `AND e.mag >= ${parseFloat(minMag)}` : "";
  const sinceCondition = since ? `AND e.event_time >= '${new Date(since).toISOString()}'` : "";
  const alertCondition = alertLevel ? `AND e.alert = '${alertLevel}'` : "";
  const regionCondition = region ? `AND e.place ILIKE '%${region}%'` : "";
  const eventClassCondition = eventClass ? `AND e.event_class = '${eventClass}'` : "";

  let orderClause = `ORDER BY "distanceKm" ASC`;
  if (orderBy === "eventTime") orderClause = `ORDER BY "eventTime" DESC`;
  else if (orderBy === "mag") orderClause = `ORDER BY mag DESC`;
  else if (orderBy === "sig") orderClause = `ORDER BY sig DESC`;
  else if (orderBy === "depth") orderClause = `ORDER BY depth DESC`;

  const events = await prisma.$queryRawUnsafe(`
    WITH filtered AS (
      SELECT DISTINCT ON (e.id)
        e.id, e.mag, e.mag_type AS "magType", e.place, e.event_time AS "eventTime",
        e.sig, e.mmi, e.alert, e.tsunami, e.felt, e.depth,
        e.latitude, e.longitude, e.status, e.net, e.url,
        e.ingested_at AS "ingestedAt",
        e.event_class AS "eventClass", e.confidence_score AS "confidenceScore", e.impact_score AS "impactScore",
        MIN(ST_Distance(e.geog, l.geog) / 1000.0) AS "distanceKm",
        l.label AS "nearestLocation"
      FROM earthquakes e
      JOIN user_locations l ON l.id = ANY($1::int[])
      WHERE ST_DWithin(e.geog, l.geog, l.radius_km * 1000)
        ${magCondition}
        ${sinceCondition}
        ${alertCondition}
        ${regionCondition}
        ${eventClassCondition}
      GROUP BY e.id, l.label
      ORDER BY e.id, "distanceKm" ASC
    )
    SELECT * FROM filtered
    ${orderClause}
    LIMIT $2 OFFSET $3
  `, locationIds, limit, offset);

  // For locations, getting exact total count is expensive with PostGIS group by.
  // We'll return a proxy count or just use the length + offset + 1 if there's more.
  // A simple heuristic: if we got 'limit' items, there might be more.
  const totalCount = events.length === limit ? offset + limit + 1 : offset + events.length;

  return { events, totalCount };
}

/**
 * Get a single event with its revision history.
 */
export async function getEventById(id) {
  const event = await prisma.earthquake.findUnique({
    where: { id },
    include: {
      revisions: { orderBy: { revisedAt: "desc" } },
    },
  });

  return event;
}

/**
 * Find user locations within range of an event (for alert evaluation).
 * Uses PostGIS ST_DWithin with each location's own radius_km.
 */
export async function findNearbyLocations(lon, lat) {
  const locations = await prisma.$queryRaw`
    SELECT id, label, latitude, longitude, radius_km AS "radiusKm",
           telegram_chat_id AS "telegramChatId",
           ST_Distance(geog, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography) / 1000.0 AS "distanceKm"
    FROM user_locations
    WHERE ST_DWithin(geog, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, radius_km * 1000)
    ORDER BY "distanceKm" ASC
  `;
  return locations;
}

/**
 * Get all distinct telegram chat IDs (for global alerts).
 */
export async function getAllChatIds() {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT telegram_chat_id AS "telegramChatId" FROM user_locations
  `;
  return rows.map((r) => r.telegramChatId);
}

/**
 * Get a full event from DB by id (for revision re-evaluation).
 */
export async function getEventForReeval(eventId) {
  return prisma.earthquake.findUnique({ where: { id: eventId } });
}
