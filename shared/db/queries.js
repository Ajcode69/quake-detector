/**
 * Database query helpers — thin wrappers over raw SQL.
 * Every function here maps to a single, testable operation.
 */

import crypto from "crypto";
import { query, getClient } from "./connection.js";
import { createLogger } from "../logger.js";

const log = createLogger("db:queries");

// Fields we track for revisions (safety-critical fields)
const WATCH_FIELDS = ["mag", "alert", "mmi", "sig", "tsunami"];

// ── Earthquake CRUD ─────────────────────────────────────────

/**
 * Upsert an earthquake event. Returns { isNew, revisions[] }.
 *
 * @param {object} feature - raw USGS GeoJSON feature
 * @returns {{ isNew: boolean, revisions: Array<{field: string, old: any, new: any}>, event: object }}
 */
export async function upsertEarthquake(feature) {
  const p = feature.properties;
  const [lon, lat, depth] = feature.geometry.coordinates;

  // Check if event already exists
  const existing = await query("SELECT * FROM earthquakes WHERE id = $1", [
    feature.id,
  ]);

  if (existing.rows.length === 0) {
    // ── New event: INSERT ────────────────────────────────────
    await query(
      `INSERT INTO earthquakes (
        id, mag, mag_type, place, event_time, updated_at,
        sig, mmi, cdi, alert, tsunami, felt, depth, status,
        net, code, ids, sources, types, nst, dmin, rms, gap,
        event_type, url, detail_url, geog
      ) VALUES (
        $1, $2, $3, $4, to_timestamp($5 / 1000.0), to_timestamp($6 / 1000.0),
        $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22, $23,
        $24, $25, $26, ST_SetSRID(ST_MakePoint($27, $28), 4326)::geography
      )`,
      [
        feature.id,
        p.mag,
        p.magType,
        p.place,
        p.time,
        p.updated,
        p.sig,
        p.mmi,
        p.cdi,
        p.alert,
        p.tsunami,
        p.felt,
        depth,
        p.status,
        p.net,
        p.code,
        p.ids,
        p.sources,
        p.types,
        p.nst,
        p.dmin,
        p.rms,
        p.gap,
        p.type || "earthquake",
        p.url,
        p.detail,
        lon,
        lat,
      ]
    );

    log.info({ id: feature.id, mag: p.mag, place: p.place }, "new event ingested");

    return {
      isNew: true,
      revisions: [],
      event: { id: feature.id, ...p, longitude: lon, latitude: lat, depth },
    };
  }

  // ── Existing event: check for revisions ───────────────────
  const old = existing.rows[0];
  const revisions = [];

  for (const field of WATCH_FIELDS) {
    const oldVal = old[field === "tsunami" ? "tsunami" : field];
    const newVal = p[field];

    if (newVal != null && String(oldVal) !== String(newVal)) {
      revisions.push({ field, old: oldVal, new: newVal });
    }
  }

  // Always update the row with latest data
  await query(
    `UPDATE earthquakes SET
      mag = $2, mag_type = $3, place = $4, updated_at = to_timestamp($5 / 1000.0),
      sig = $6, mmi = $7, cdi = $8, alert = $9, tsunami = $10,
      felt = $11, depth = $12, status = $13,
      nst = $14, dmin = $15, rms = $16, gap = $17,
      geog = ST_SetSRID(ST_MakePoint($18, $19), 4326)::geography
    WHERE id = $1`,
    [
      feature.id,
      p.mag,
      p.magType,
      p.place,
      p.updated,
      p.sig,
      p.mmi,
      p.cdi,
      p.alert,
      p.tsunami,
      p.felt,
      depth,
      p.status,
      p.nst,
      p.dmin,
      p.rms,
      p.gap,
      lon,
      lat,
    ]
  );

  // Record revisions in DB
  if (revisions.length > 0) {
    const client = await getClient();
    try {
      await client.query("BEGIN");
      for (const rev of revisions) {
        await client.query(
          `INSERT INTO event_revisions (event_id, field_name, old_value, new_value)
           VALUES ($1, $2, $3, $4)`,
          [feature.id, rev.field, String(rev.old), String(rev.new)]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    log.info(
      { id: feature.id, revisions: revisions.map((r) => `${r.field}: ${r.old} → ${r.new}`) },
      "event revised"
    );
  }

  return {
    isNew: false,
    revisions,
    event: { id: feature.id, ...p, longitude: lon, latitude: lat, depth },
  };
}

// ── Proximity queries ───────────────────────────────────────

/**
 * Find user locations within radius of an event.
 * @param {number} lon
 * @param {number} lat
 * @returns {Promise<Array>} locations with distance_km
 */
export async function findNearbyLocations(lon, lat) {
  const result = await query(
    `SELECT *,
       ST_Distance(geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0 AS distance_km
     FROM user_locations
     WHERE ST_DWithin(geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, radius_km * 1000)
     ORDER BY distance_km ASC`,
    [lon, lat]
  );
  return result.rows;
}

// ── Alert dedup ─────────────────────────────────────────────

/**
 * Compute dedup hash for an alert.
 */
export function computeAlertHash(eventId, chatId) {
  return crypto
    .createHash("sha256")
    .update(`${eventId}:${chatId}`)
    .digest("hex");
}

/**
 * Check if an alert already exists for this event+user within the cooldown window.
 * @param {string} eventId
 * @param {number} chatId
 * @param {number} cooldownHours
 * @returns {Promise<boolean>}
 */
export async function isDuplicateAlert(eventId, chatId, cooldownHours = 1) {
  const hash = computeAlertHash(eventId, chatId);
  const result = await query(
    `SELECT id FROM alerts_log
     WHERE dedup_hash = $1
       AND created_at > NOW() - INTERVAL '1 hour' * $2`,
    [hash, cooldownHours]
  );
  return result.rows.length > 0;
}

/**
 * Save an alert to the audit log.
 */
export async function saveAlert({ eventId, chatId, ruleType, severity, message, isRevision = false }) {
  const hash = computeAlertHash(eventId, chatId);
  await query(
    `INSERT INTO alerts_log (event_id, chat_id, rule_type, severity, message, is_revision, dedup_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (dedup_hash) DO NOTHING`,
    [eventId, chatId, ruleType, severity, message, isRevision, hash]
  );
}

/**
 * Mark an alert as sent.
 */
export async function markAlertSent(alertId) {
  await query(
    "UPDATE alerts_log SET sent = TRUE, sent_at = NOW() WHERE id = $1",
    [alertId]
  );
}

/**
 * Get unsent alerts for retry.
 */
export async function getUnsentAlerts(limit = 50) {
  const result = await query(
    `SELECT * FROM alerts_log WHERE sent = FALSE ORDER BY created_at ASC LIMIT $1`,
    [limit]
  );
  return result.rows;
}

// ── Poll health ─────────────────────────────────────────────

export async function recordPollHealth({ status, eventsFetched, newEvents, revisions, responseMs, errorMessage }) {
  await query(
    `INSERT INTO poll_health (status, events_fetched, new_events, revisions, response_ms, error_message)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [status, eventsFetched, newEvents, revisions, responseMs, errorMessage]
  );
}

// ── Checkpoints ─────────────────────────────────────────────

export async function getCheckpoint(key) {
  const result = await query("SELECT value FROM checkpoints WHERE key = $1", [key]);
  return result.rows[0]?.value || null;
}

export async function setCheckpoint(key, value) {
  await query(
    `INSERT INTO checkpoints (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, String(value)]
  );
}

// ── Read queries (for API routes) ───────────────────────────

export async function getEvents({ limit = 50, offset = 0, minMag, since }) {
  let sql = "SELECT *, ST_X(geog::geometry) AS longitude, ST_Y(geog::geometry) AS latitude FROM earthquakes WHERE 1=1";
  const params = [];
  let idx = 1;

  if (minMag != null) {
    sql += ` AND mag >= $${idx++}`;
    params.push(minMag);
  }
  if (since) {
    sql += ` AND event_time >= $${idx++}`;
    params.push(since);
  }

  sql += ` ORDER BY event_time DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(limit, offset);

  const result = await query(sql, params);
  return result.rows;
}

export async function getEventById(id) {
  const event = await query(
    "SELECT *, ST_X(geog::geometry) AS longitude, ST_Y(geog::geometry) AS latitude FROM earthquakes WHERE id = $1",
    [id]
  );
  const revisions = await query(
    "SELECT * FROM event_revisions WHERE event_id = $1 ORDER BY revised_at DESC",
    [id]
  );
  return { event: event.rows[0] || null, revisions: revisions.rows };
}

export async function getHealthHistory(limit = 20) {
  const result = await query(
    "SELECT * FROM poll_health ORDER BY polled_at DESC LIMIT $1",
    [limit]
  );
  return result.rows;
}
