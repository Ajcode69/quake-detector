/**
 * Alert service — dedup, save, mark sent, retry.
 */

import crypto from "crypto";
import prisma from "../../../../shared/db/client.js";

/**
 * Compute dedup hash: sha256(eventId:chatId).
 */
export function computeAlertHash(eventId, chatId) {
  return crypto.createHash("sha256").update(`${eventId}:${chatId}`).digest("hex");
}

/**
 * Check if an alert already exists for this event+user within cooldown.
 */
export async function isDuplicateAlert(eventId, chatId, cooldownHours = 1) {
  const hash = computeAlertHash(eventId, chatId);
  const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);

  const existing = await prisma.alertLog.findFirst({
    where: { dedupHash: hash, createdAt: { gt: cutoff } },
    select: { id: true },
  });

  return !!existing;
}

/**
 * Save an alert to the audit log (ON CONFLICT DO NOTHING via unique dedup_hash).
 */
export async function saveAlert({ eventId, chatId, ruleType, severity, message, isRevision = false }) {
  const hash = computeAlertHash(eventId, chatId);

  try {
    await prisma.alertLog.create({
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
    // Unique constraint on dedup_hash — expected for duplicates
    if (err.code === "P2002") return;
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
  });
}
