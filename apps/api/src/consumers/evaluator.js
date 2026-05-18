/**
 * Consumer: alert-evaluator
 * Reads earthquake.raw + earthquake.revisions → evaluates alert rules
 * against user locations → produces matched alerts to earthquake.alerts topic.
 *
 * Alert rules:
 *   1. Global:    mag >= 5.0 anywhere → alert all users
 *   2. Proximity: mag >= 3.0 within user's radius_km → alert that user
 *   3. Tsunami:   tsunami === 1 → alert all users (life-safety)
 */

import { createLogger } from "../../../../shared/logger.js";
import { TOPICS } from "../../../../shared/kafka/topics.js";
import { findNearbyLocations, isDuplicateAlert } from "../../../../shared/db/queries.js";
import { query } from "../../../../shared/db/connection.js";

const log = createLogger("consumer:evaluator");

// Thresholds — product judgment: these are the numbers we chose and can justify
const GLOBAL_MAG_THRESHOLD = 5.0;
const PROXIMITY_MAG_THRESHOLD = 3.0;
const SIGNIFICANT_SIG_THRESHOLD = 600; // sig > 600 is noteworthy

/**
 * Start the evaluator consumer.
 * @param {import('kafkajs').Consumer} consumer
 * @param {import('kafkajs').Producer} producer - to produce to alerts topic
 */
export async function startEvaluator(consumer, producer) {
  await consumer.subscribe({ topics: [TOPICS.RAW, TOPICS.REVISIONS], fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      try {
        const payload = JSON.parse(message.value.toString());

        // Skip backfill events — don't alert on month-old earthquakes
        if (payload._backfill) return;

        if (topic === TOPICS.RAW) {
          await evaluateEvent(payload, producer, false);
        } else if (topic === TOPICS.REVISIONS) {
          await evaluateRevision(payload, producer);
        }
      } catch (err) {
        log.error({ err, topic }, "evaluator failed to process message");
      }
    },
  });

  log.info("evaluator consumer running");
}

/**
 * Evaluate alert rules for a single event.
 * Merges all triggered rules into ONE alert per user (no duplicates).
 */
async function evaluateEvent(event, producer, isRevision) {
  const { id, mag, tsunami, sig, longitude, latitude, place } = event;
  const triggeredAlerts = []; // { chatId, rules[], severity }

  // ── Rule 1: Global magnitude ──────────────────────────────
  if (mag >= GLOBAL_MAG_THRESHOLD) {
    const allUsers = await query("SELECT DISTINCT telegram_chat_id FROM user_locations");
    for (const row of allUsers.rows) {
      addOrMergeAlert(triggeredAlerts, row.telegram_chat_id, {
        type: "global",
        reason: `M${mag} exceeds global threshold (≥${GLOBAL_MAG_THRESHOLD})`,
      });
    }
  }

  // ── Rule 2: Proximity ─────────────────────────────────────
  if (mag >= PROXIMITY_MAG_THRESHOLD && longitude != null && latitude != null) {
    const nearbyLocations = await findNearbyLocations(longitude, latitude);
    for (const loc of nearbyLocations) {
      addOrMergeAlert(triggeredAlerts, loc.telegram_chat_id, {
        type: "proximity",
        reason: `M${mag} is ${Math.round(loc.distance_km)}km from "${loc.label}"`,
        locationLabel: loc.label,
        distanceKm: Math.round(loc.distance_km),
      });
    }
  }

  // ── Rule 3: Tsunami ───────────────────────────────────────
  if (tsunami === 1) {
    const allUsers = await query("SELECT DISTINCT telegram_chat_id FROM user_locations");
    for (const row of allUsers.rows) {
      addOrMergeAlert(triggeredAlerts, row.telegram_chat_id, {
        type: "tsunami",
        reason: "⚠️ Tsunami warning issued",
      });
    }
  }

  // ── Produce merged alerts ─────────────────────────────────
  for (const alert of triggeredAlerts) {
    // Dedup check: skip if already alerted for this event+user
    const duplicate = await isDuplicateAlert(id, alert.chatId);
    if (duplicate) {
      log.debug({ eventId: id, chatId: alert.chatId }, "duplicate alert skipped");
      continue;
    }

    const severity = determineSeverity(mag, tsunami, sig);
    const alertPayload = {
      eventId: id,
      chatId: alert.chatId,
      rules: alert.rules,
      severity,
      isRevision,
      event: { mag, place, sig, tsunami, depth: event.depth, alert: event.alert },
      timestamp: Date.now(),
    };

    await producer.send({
      topic: TOPICS.ALERTS,
      messages: [
        {
          key: String(alert.chatId), // partition by user
          value: JSON.stringify(alertPayload),
        },
      ],
    });

    log.info(
      { eventId: id, chatId: alert.chatId, rules: alert.rules.map((r) => r.type), severity },
      "alert produced"
    );
  }
}

/**
 * Evaluate a revision — re-check alert rules if critical fields changed.
 */
async function evaluateRevision(payload, producer) {
  const { eventId, revisions } = payload;

  // Only re-evaluate if safety-critical fields changed
  const criticalFields = ["mag", "alert", "tsunami", "mmi"];
  const hasCriticalChange = revisions.some((r) => criticalFields.includes(r.field));

  if (!hasCriticalChange) return;

  // Fetch the updated event from DB
  const result = await query(
    "SELECT *, ST_X(geog::geometry) AS longitude, ST_Y(geog::geometry) AS latitude FROM earthquakes WHERE id = $1",
    [eventId]
  );
  if (result.rows.length === 0) return;

  const event = result.rows[0];
  const mapped = {
    id: event.id,
    mag: parseFloat(event.mag),
    place: event.place,
    sig: event.sig,
    tsunami: event.tsunami,
    depth: parseFloat(event.depth),
    alert: event.alert,
    longitude: parseFloat(event.longitude),
    latitude: parseFloat(event.latitude),
  };

  log.info(
    { eventId, changes: revisions.map((r) => `${r.field}: ${r.old}→${r.new}`) },
    "re-evaluating revised event"
  );

  await evaluateEvent(mapped, producer, true);
}

// ── Helpers ─────────────────────────────────────────────────

/**
 * Merge rules for the same chatId into one alert (prevents 2 alerts for same user).
 */
function addOrMergeAlert(alerts, chatId, rule) {
  const existing = alerts.find((a) => a.chatId === chatId);
  if (existing) {
    existing.rules.push(rule);
  } else {
    alerts.push({ chatId, rules: [rule] });
  }
}

function determineSeverity(mag, tsunami, sig) {
  if (tsunami === 1 || mag >= 6.0) return "critical";
  if (mag >= 5.0 || sig >= SIGNIFICANT_SIG_THRESHOLD) return "warning";
  return "info";
}
