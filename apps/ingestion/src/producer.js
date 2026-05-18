/**
 * Kafka producer — sends events to the right topics.
 * Used by the poller after fetching + upserting events.
 */

import { createKafkaClient } from "../../../shared/kafka/client.js";
import { TOPICS } from "../../../shared/kafka/topics.js";
import { createLogger } from "../../../shared/logger.js";

const log = createLogger("producer");

let producer = null;

/**
 * Connect the Kafka producer.
 */
export async function connectProducer() {
  const kafka = createKafkaClient("ingestion-worker");
  producer = kafka.producer({
    allowAutoTopicCreation: false,
    idempotent: true, // exactly-once semantics within a session
  });

  await producer.connect();
  log.info("kafka producer connected");
}

/**
 * Send a new or updated earthquake event to the raw topic.
 * Partition key = USGS network code (us, ak, ci, etc.) for regional grouping.
 *
 * @param {object} event - parsed event object from upsert
 */
export async function produceRawEvent(event) {
  await producer.send({
    topic: TOPICS.RAW,
    messages: [
      {
        key: event.net || "unknown",
        value: JSON.stringify(event),
        headers: {
          source: "usgs",
          ingestedAt: String(Date.now()),
        },
      },
    ],
  });
}

/**
 * Send revision diffs to the compacted revisions topic.
 * Key = event_id (for log compaction — latest state per event).
 *
 * @param {string} eventId
 * @param {Array<{field: string, old: any, new: any}>} revisions
 */
export async function produceRevisions(eventId, revisions) {
  await producer.send({
    topic: TOPICS.REVISIONS,
    messages: [
      {
        key: eventId,
        value: JSON.stringify({ eventId, revisions, timestamp: Date.now() }),
      },
    ],
  });

  log.info({ eventId, count: revisions.length }, "revisions published");
}

/**
 * Graceful shutdown.
 */
export async function disconnectProducer() {
  if (producer) {
    await producer.disconnect();
    log.info("kafka producer disconnected");
  }
}
