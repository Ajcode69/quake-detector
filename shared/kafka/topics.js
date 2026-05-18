/**
 * Kafka topic definitions — the data contracts of the system.
 *
 * earthquake.raw        — every ingested event (partitioned by USGS network code)
 * earthquake.alerts     — evaluated alerts ready for delivery (partitioned by chat_id)
 * earthquake.revisions  — field-level diffs on updated events (compacted by event_id)
 */

export const TOPICS = {
  RAW: "earthquake.raw",
  ALERTS: "earthquake.alerts",
  REVISIONS: "earthquake.revisions",
};

/**
 * Topic configs for setup script.
 */
export const TOPIC_CONFIGS = [
  {
    topic: TOPICS.RAW,
    numPartitions: 3,
    replicationFactor: 1,
    configEntries: [{ name: "retention.ms", value: String(7 * 24 * 60 * 60 * 1000) }], // 7 days
  },
  {
    topic: TOPICS.ALERTS,
    numPartitions: 2,
    replicationFactor: 1,
    configEntries: [{ name: "retention.ms", value: String(30 * 24 * 60 * 60 * 1000) }], // 30 days
  },
  {
    topic: TOPICS.REVISIONS,
    numPartitions: 1,
    replicationFactor: 1,
    configEntries: [
      { name: "cleanup.policy", value: "compact" },   // log compaction — latest state per event
      { name: "min.cleanable.dirty.ratio", value: "0.5" },
    ],
  },
];
