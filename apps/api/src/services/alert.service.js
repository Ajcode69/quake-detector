/**
 * Alert service — dedup, save, mark sent, retry, severity escalation.
 */

import crypto from "crypto";
import prisma from "../../../../shared/db/client.js";

const SEVERITY_RANK = { info: 1, warning: 2, critical: 3 };

/**
 * Compute dedup hash: sha256(eventId:chatId).
 */
export function computeAlertHash(eventId, chatId) {
  return crypto.createHash("sha256").update(`${eventId}:${chatId}`).digest("hex");
}

/**
 * Compute swarm dedup hash — tied to cluster center + time window, not a single event.
 * @param {number} lon - cluster center longitude (rounded to 0.5°)
 * @param {number} lat - cluster center latitude (rounded to 0.5°)
 * @param {number|string} chatId
 * @param {number} windowHours - swarm detection window
 */
export function computeSwarmHash(lon, lat, chatId, windowHours = 6) {
  const windowBucket = Math.floor(Date.now() / (windowHours * 3600 * 1000));
  const clusterKey = `${Math.round(lon * 2) / 2}:${Math.round(lat * 2) / 2}`;
  return crypto.createHash("sha256").update(`swarm:${clusterKey}:${chatId}:${windowBucket}`).digest("hex");
}

/**
 * Check if an alert already exists for this event+user within cooldown.
 * Allows re-alerting on severity ESCALATION (info→warning, warning→critical).
 */
export async function isDuplicateAlert(eventId, chatId, newSeverity = "info", cooldownHours = 1) {
  const hash = computeAlertHash(eventId, chatId);
  const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);

  const existing = await prisma.alertLog.findFirst({
    where: { dedupHash: hash, createdAt: { gt: cutoff } },
    select: { id: true, severity: true },
  });

  if (!existing) return false;

  // Allow re-alert on severity escalation
  if ((SEVERITY_RANK[newSeverity] || 0) > (SEVERITY_RANK[existing.severity] || 0)) {
    return false; // NOT a duplicate — severity escalated
  }

  return true;
}

/**
 * Check swarm dedup — different hash scheme.
 */
export async function isSwarmDuplicate(lon, lat, chatId, windowHours = 6) {
  const hash = computeSwarmHash(lon, lat, chatId, windowHours);
  const cutoff = new Date(Date.now() - windowHours * 3600 * 1000);

  const existing = await prisma.alertLog.findFirst({
    where: { dedupHash: hash, createdAt: { gt: cutoff } },
    select: { id: true },
  });

  return !!existing;
}

/**
 * Save an alert to the audit log.
 */
export async function saveAlert({ eventId, chatId, ruleType, severity, message, isRevision = false, dedupHash }) {
  const hash = dedupHash || computeAlertHash(eventId, chatId);

  try {
    return await prisma.alertLog.create({
      data: {
        eventId,
        chatId: BigInt(chatId),
        ruleType,
        severity,
        message,
        isRevision,
        dedupHash: hash,
      },
    });
  } catch (err) {
    if (err.code === "P2002") return null; // unique constraint — expected
    throw err;
  }
}

/**
 * Mark an alert as sent.
 */
export async function markAlertSent(id) {
  await prisma.alertLog.update({
    where: { id },
    data: { sent: true, sentAt: new Date() },
  });
}

/**
 * Get unsent alerts for retry sweep.
 */
export async function getUnsentAlerts(limit = 50) {
  return prisma.alertLog.findMany({
    where: { sent: false },
    orderBy: { createdAt: "asc" },
    take: limit,
    include: { earthquake: { select: { place: true } } },
  });
}
