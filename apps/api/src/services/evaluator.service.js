import { createLogger } from "../../../../shared/logger.js";
import { getEventForReeval } from "../services/earthquake.service.js";
import { findNearbyLocations, getAllChatIds } from "../services/location.cache.js";
import { isDuplicateAlert, isSwarmDuplicate, computeSwarmHash, saveAlert } from "../services/alert.service.js";
import { detectSwarm, SWARM_WINDOW_HOURS, SWARM_RADIUS_KM } from "../services/swarm.service.js";
import { formatAlertMessage } from "./notifier.service.js";
import prisma from "../../../../shared/db/client.js";

const log = createLogger("evaluator");

// Tier 1 thresholds
const GLOBAL_MAG_THRESHOLD = 5.0;
// Tier 2 default (overridden by user_alert_rules)
const DEFAULT_PROXIMITY_MAG = 3.0;
const SIGNIFICANT_SIG_THRESHOLD = 600;

/**
 * Handle system alerts (source silence, etc.).
 */
export async function handleSystemAlert(payload) {
  const chatIds = await getAllChatIds();
  for (const chatId of chatIds) {
    const alertData = {
      eventId: payload.id,
      chatId: String(chatId),
      rules: [{ type: "system", reason: `⚠️ USGS unreachable for ${payload.consecutiveFailures} consecutive polls` }],
      severity: "warning",
      isRevision: false,
      event: { mag: null, place: "System Alert", sig: null, tsunami: 0, depth: null, alert: null },
      _systemAlert: true,
      timestamp: Date.now(),
    };

    const saved = await saveAlert({
      eventId: alertData.eventId,
      chatId: alertData.chatId,
      ruleType: "system",
      severity: alertData.severity,
      message: formatAlertMessage(alertData),
      isRevision: false,
      dedupHash: `sys-${payload.consecutiveFailures}-${chatId}`
    });

    if (saved) {
      await prisma.$executeRawUnsafe(`NOTIFY earthquake_alerts, '{"id": ${saved.id}}'`);
    }
  }
  log.warn({ failures: payload.consecutiveFailures }, "source silence alert produced");
}

/**
 * Evaluate all alert tiers for a single event.
 */
export async function evaluateEvent(event, isRevision) {
  const { id, mag, tsunami, sig, longitude, latitude, place } = event;
  const triggeredAlerts = [];
  const severity = determineSeverity(mag, tsunami, sig);

  // ── Tier 1: General alerts (all users) ────────────────────

  // Rule 1a: Global magnitude
  if (mag >= GLOBAL_MAG_THRESHOLD) {
    const chatIds = await getAllChatIds();
    for (const chatId of chatIds) {
      addOrMergeAlert(triggeredAlerts, chatId, {
        type: "global",
        reason: `M${mag} exceeds global threshold (≥${GLOBAL_MAG_THRESHOLD})`,
      });
    }
  }

  // Rule 1b: Tsunami
  if (tsunami === 1) {
    const chatIds = await getAllChatIds();
    for (const chatId of chatIds) {
      addOrMergeAlert(triggeredAlerts, chatId, {
        type: "tsunami",
        reason: "⚠️ Tsunami warning issued",
      });
    }
  }

  // ── Tier 2: Location-based alerts (per-user) ─────────────

  if (mag >= 1.0 && longitude != null && latitude != null) {
    const nearbyLocations = await findNearbyLocations(longitude, latitude);

    for (const loc of nearbyLocations) {
      // Load custom rules for this user+location
      const userRule = await getUserAlertRule(loc.userId, loc.id);
      const effectiveMinMag = userRule?.minMag ?? DEFAULT_PROXIMITY_MAG;

      // Check magnitude threshold
      if (mag < effectiveMinMag) continue;

      // Check quiet hours
      if (userRule && isInQuietHours(userRule.quietHoursStart, userRule.quietHoursEnd)) continue;

      // Check if user disabled alerts
      if (userRule?.enabled === false) continue;

      // Broadcast to all active chats of this user
      const userChats = await prisma.telegramChat.findMany({
        where: { userId: loc.userId },
        select: { telegramChatId: true }
      });
      const chatIds = userChats.map((c) => c.telegramChatId);

      for (const chatId of chatIds) {
        addOrMergeAlert(triggeredAlerts, chatId, {
          type: "proximity",
          reason: `M${mag} is ${Math.round(loc.distanceKm)}km from "${loc.label}"`,
          locationLabel: loc.label,
          distanceKm: Math.round(loc.distanceKm),
        });
      }
    }
  }

  // ── Tier 3: Swarm detection ───────────────────────────────

  if (mag >= 1.5 && longitude != null && latitude != null) {
    // Check if any user location is near this event before running the heavier swarm query.
    const nearbyLocations = await findNearbyLocations(longitude, latitude);

    if (nearbyLocations.length > 0) {
      const swarm = await detectSwarm(longitude, latitude, { excludeEventId: id });

      if (swarm) {
        for (const loc of nearbyLocations) {
          // Broadcast to all active chats of this user
          const userChats = await prisma.telegramChat.findMany({
            where: { userId: loc.userId },
            select: { telegramChatId: true }
          });
          const chatIds = userChats.map((c) => c.telegramChatId);

          for (const chatId of chatIds) {
            // Check swarm-specific dedup (cluster-center + time window)
            const isDup = await isSwarmDuplicate(longitude, latitude, chatId, SWARM_WINDOW_HOURS);
            if (isDup) continue;

            addOrMergeAlert(triggeredAlerts, chatId, {
              type: "swarm",
              reason: `🔄 ${swarm.count} earthquakes within ${SWARM_RADIUS_KM}km in last ${SWARM_WINDOW_HOURS}h (max M${swarm.maxMag})`,
              swarmData: swarm,
            });
          }
        }
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

    let dedupHash = undefined;
    // Use swarm dedup hash if swarm rule is present
    if (hasSwarmRule) {
      const swarmRule = alert.rules.find((r) => r.type === "swarm");
      dedupHash = computeSwarmHash(
        swarmRule.swarmData.centerLon,
        swarmRule.swarmData.centerLat,
        alert.chatId,
        SWARM_WINDOW_HOURS
      );
    }

    const saved = await saveAlert({
      eventId: id,
      chatId: String(alert.chatId),
      ruleType: alert.rules.map((r) => r.type).join(","),
      severity,
      message: formatAlertMessage(alertPayload),
      isRevision,
      dedupHash,
    });

    if (saved) {
      await prisma.$executeRawUnsafe(`NOTIFY earthquake_alerts, '{"id": ${saved.id}}'`);
      log.info({ eventId: id, chatId: String(alert.chatId), rules: alert.rules.map((r) => r.type), severity }, "alert produced");
    }
  }
}

/**
 * Re-evaluate a revised event.
 */
export async function evaluateRevision(eventId) {
  const event = await getEventForReeval(eventId);
  if (!event) return;

  log.info({ eventId }, "re-evaluating revised event");

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
  }, true);
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
async function getUserAlertRule(userId, locationId) {
  try {
    return await prisma.userAlertRule.findFirst({
      where: {
        userId: parseInt(userId),
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
