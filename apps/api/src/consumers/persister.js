/**
 * Consumer: event-persister
 * Reads earthquake.raw → upserts to Postgres (already done by ingestion,
 * but this ensures the API process has its own view) → pushes to SSE clients.
 *
 * In practice: the ingestion worker already writes to Postgres.
 * This consumer's primary job is to broadcast to SSE clients in real time.
 */

import { createLogger } from "../../../../shared/logger.js";
import { TOPICS } from "../../../../shared/kafka/topics.js";

const log = createLogger("consumer:persister");

// SSE clients registry — populated by the SSE route
export const sseClients = new Set();

/**
 * Broadcast an event to all connected SSE clients.
 */
function broadcastToSSE(event) {
  const data = JSON.stringify(event);
  for (const res of sseClients) {
    try {
      res.write(`data: ${data}\n\n`);
    } catch {
      sseClients.delete(res);
    }
  }
}

/**
 * Start the persister consumer.
 * @param {import('kafkajs').Consumer} consumer
 */
export async function startPersister(consumer) {
  await consumer.subscribe({ topic: TOPICS.RAW, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const event = JSON.parse(message.value.toString());

        // Skip backfill events for SSE broadcast (old data, no live push)
        if (event._backfill) return;

        broadcastToSSE(event);

        log.debug({ id: event.id, mag: event.mag }, "event broadcast to SSE");
      } catch (err) {
        log.error({ err }, "persister failed to process message");
      }
    },
  });

  log.info("persister consumer running");
}
