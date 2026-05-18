/**
 * Consumer: alert-evaluator
 * Reads earthquake.raw + earthquake.revisions → evaluates alert rules → produces to earthquake.alerts.
 *
 * Alert tiers:
 *   Tier 1 (General):   mag >= 5.0 anywhere, tsunami, source silence
 *   Tier 2 (Location):  proximity within user's radius_km, respects custom rules
 *   Tier 3 (Swarm):     5+ events within 50km in 6 hours near user locations
 */

import { createLogger } from "../../../../shared/logger.js";
import { TOPICS } from "../../../../shared/kafka/topics.js";
import { getEventForReeval } from "../services/earthquake.service.js";
import { findNearbyLocationsCached, getAllChatIdsCached, startLocationCache } from "../services/location.cache.js";
import { isDuplicateAlert, isSwarmDuplicate, computeSwarmHash } from "../services/alert.service.js";
import { detectSwarm, SWARM_WINDOW_HOURS, SWARM_RADIUS_KM } from "../services/swarm.service.js";
import prisma from "../../../../shared/db/client.js";

const log = createLogger("consumer:evaluator");

// Tier 1 thresholds
const GLOBAL_MAG_THRESHOLD = 5.0;
// Tier 2 default (overridden by user_alert_rules)
const DEFAULT_PROXIMITY_MAG = 3.0;
const SIGNIFICANT_SIG_THRESHOLD = 600;

/**
 * Start the evaluator consumer.
 */
export async function startEvaluator(consumer, producer) {
  // Start the in-memory location cache BEFORE subscribing
  await startLocationCache();

  await consumer.subscribe({ topics: [TOPICS.RAW, TOPICS.REVISIONS], fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      try {
        const payload = JSON.parse(message.value.toString());
        if (payload._backfill) return;

        // Handle system alerts (source silence, etc.)
        if (payload._systemAlert) {
          await handleSystemAlert(payload, producer);
          return;
        }

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
 * Handle system alerts (source silence, etc.).
 */
async function handleSystemAlert(payload, producer) {
  const chatIds = getAllChatIdsCached();
  for (const chatId of chatIds) {
    await producer.send({
      topic: TOPICS.ALERTS,
      messages: [{
        key: String(chatId),
        value: JSON.stringify({
          eventId: payload.id,
          chatId: String(chatId),
          rules: [{ type: "system", reason: `⚠️ USGS unreachable for ${payload.consecutiveFailures} consecutive polls` }],
          severity: "warning",
          isRevision: false,
          event: { mag: null, place: "System Alert", sig: null, tsunami: 0, depth: null, alert: null },
          _systemAlert: true,
          timestamp: Date.now(),
        }),
      }],
    });
  }
  log.warn({ failures: payload.consecutiveFailures }, "source silence alert produced");
}

/**
 * Evaluate all alert tiers for a single event.
 */
async function evaluateEvent(event, producer, isRevision) {
  const { id, mag, tsunami, sig, longitude, latitude, place } = event;
  const triggeredAlerts = [];
  const severity = determineSeverity(mag, tsunami, sig);

  // ── Tier 1: General alerts (all users) ────────────────────

  // Rule 1a: Global magnitude
  if (mag >= GLOBAL_MAG_THRESHOLD) {
    const chatIds = getAllChatIdsCached();
    for (const chatId of chatIds) {
      addOrMergeAlert(triggeredAlerts, chatId, {
        type: "global",
        reason: `M${mag} exceeds global threshold (≥${GLOBAL_MAG_THRESHOLD})`,
      });
    }
  }

  // Rule 1b: Tsunami
  if (tsunami === 1) {
    const chatIds = getAllChatIdsCached();
    for (const chatId of chatIds) {
      addOrMergeAlert(triggeredAlerts, chatId, {
        type: "tsunami",
        reason: "⚠️ Tsunami warning issued",
      });
    }
  }

  // ── Tier 2: Location-based alerts (per-user) ─────────────

  if (mag >= 1.0 && longitude != null && latitude != null) {
    const nearbyLocations = findNearbyLocationsCached(longitude, latitude);

    for (const loc of nearbyLocations) {
      // Load custom rules for this user+location
      const userRule = await getUserAlertRule(loc.telegramChatId, loc.id);
      const effectiveMinMag = userRule?.minMag ?? DEFAULT_PROXIMITY_MAG;

      // Check magnitude threshold
      if (mag < effectiveMinMag) continue;

      // Check quiet hours
      if (userRule && isInQuietHours(userRule.quietHoursStart, userRule.quietHoursEnd)) continue;

      // Check if user disabled alerts
      if (userRule?.enabled === false) continue;

      addOrMergeAlert(triggeredAlerts, loc.telegramChatId, {
        type: "proximity",
        reason: `M${mag} is ${Math.round(loc.distanceKm)}km from "${loc.label}"`,
        locationLabel: loc.label,
        distanceKm: Math.round(loc.distanceKm),
      });
    }
  }

  // ── Tier 3: Swarm detection ───────────────────────────────

  if (mag >= 1.5 && longitude != null && latitude != null) {
    const swarm = await detectSwarm(longitude, latitude, id);

    if (swarm) {
      const nearbyLocations = findNearbyLocationsCached(longitude, latitude);

      for (const loc of nearbyLocations) {
        // Check swarm-specific dedup (cluster-center + time window)
        const isDup = await isSwarmDuplicate(longitude, latitude, loc.telegramChatId, SWARM_WINDOW_HOURS);
        if (isDup) continue;

        addOrMergeAlert(triggeredAlerts, loc.telegramChatId, {
          type: "swarm",
          reason: `🔄 ${swarm.count} earthquakes within ${SWARM_RADIUS_KM}km in last ${SWARM_WINDOW_HOURS}h (max M${swarm.maxMag})`,
          swarmData: swarm,
        });
      }
    }
  }

  // ── Produce merged alerts ─────────────────────────────────

  for (const alert of triggeredAlerts) {
    // Dedup check with severity escalation
    const hasSwarmRule = alert.rules.some((r) => r.type === "swarm");

    if (!hasSwarmRule) {
      // Normal dedup for non-swarm alerts
      const duplicate = await isDuplicateAlert(id, alert.chatId, severity);
      if (duplicate) {
        log.debug({ eventId: id, chatId: alert.chatId }, "duplicate alert skipped");
        continue;
      }
    }

    const alertPayload = {
      eventId: id,
      chatId: String(alert.chatId),
      rules: alert.rules,
      severity,
      isRevision,
      event: { mag, place, sig, tsunami, depth: event.depth, alert: event.alert },
      timestamp: Date.now(),
    };

    // Use swarm dedup hash if swarm rule is present
    if (hasSwarmRule) {
      const swarmRule = alert.rules.find((r) => r.type === "swarm");
      alertPayload.dedupHash = computeSwarmHash(
        swarmRule.swarmData.centerLon,
        swarmRule.swarmData.centerLat,
        alert.chatId,
        SWARM_WINDOW_HOURS
      );
    }

    await producer.send({
      topic: TOPICS.ALERTS,
      messages: [{ key: String(alert.chatId), value: JSON.stringify(alertPayload) }],
    });

    log.info(
      { eventId: id, chatId: String(alert.chatId), rules: alert.rules.map((r) => r.type), severity },
      "alert produced"
    );
  }
}

/**
 * Re-evaluate a revised event (only if safety-critical fields changed).
 */
async function evaluateRevision(payload, producer) {
  const { eventId, revisions } = payload;
  const criticalFields = ["mag", "alert", "tsunami", "mmi"];
  if (!revisions.some((r) => criticalFields.includes(r.field))) return;

  const event = await getEventForReeval(eventId);
  if (!event) return;

  log.info(
    { eventId, changes: revisions.map((r) => `${r.field}: ${r.old}→${r.new}`) },
    "re-evaluating revised event"
  );

  await evaluateEvent({
    id: event.id,
    mag: parseFloat(event.mag),
    place: event.place,
    sig: event.sig,
    tsunami: event.tsunami,
    depth: parseFloat(event.depth),
    alert: event.alert,
    longitude: parseFloat(event.longitude),
    latitude: parseFloat(event.latitude),
  }, producer, true);
}

// ── Helpers ─────────────────────────────────────────────────

function addOrMergeAlert(alerts, chatId, rule) {
  const existing = alerts.find((a) => String(a.chatId) === String(chatId));
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

/**
 * Load custom alert rules for a user+location (cached per evaluator lifecycle).
 */
async function getUserAlertRule(telegramChatId, locationId) {
  try {
    return await prisma.userAlertRule.findFirst({
      where: {
        telegramChatId: BigInt(telegramChatId),
        OR: [{ locationId }, { locationId: null }], // specific or global rule
        enabled: true,
      },
      orderBy: { locationId: "desc" }, // prefer location-specific over global
    });
  } catch {
    return null; // if table doesn't exist yet, default behavior
  }
}

/**
 * Check if current UTC hour falls within quiet hours window.
 */
function isInQuietHours(start, end) {
  if (start == null || end == null) return false;
  const hour = new Date().getUTCHours();
  if (start <= end) {
    return hour >= start && hour < end;
  }
  // Wraps midnight: e.g. 22→6
  return hour >= start || hour < end;
}
