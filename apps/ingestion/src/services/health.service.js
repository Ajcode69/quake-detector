/**
 * Health + checkpoint service for the ingestion worker.
 */

import prisma from "../../../../shared/db/client.js";

/**
 * Record a poll health entry.
 */
export async function recordPollHealth({ status, eventsFetched, newEvents, revisions, responseMs, errorMessage }) {
  await prisma.pollHealth.create({
    data: { status, eventsFetched, newEvents, revisions, responseMs, errorMessage },
  });
}

/**
 * Get a checkpoint value by key.
 */
export async function getCheckpoint(key) {
  const row = await prisma.checkpoint.findUnique({ where: { key } });
  return row?.value ?? null;
}

/**
 * Set a checkpoint value (upsert).
 */
export async function setCheckpoint(key, value) {
  await prisma.checkpoint.upsert({
    where: { key },
    create: { key, value: String(value) },
    update: { value: String(value), updatedAt: new Date() },
  });
}
