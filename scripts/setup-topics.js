/**
 * Create Kafka topics in Redpanda.
 * Usage:  npm run topics
 */

import { createKafkaClient } from "../shared/kafka/client.js";
import { TOPIC_CONFIGS } from "../shared/kafka/topics.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("setup-topics");

async function main() {
  const kafka = createKafkaClient("topic-admin");
  const admin = kafka.admin();

  await admin.connect();
  log.info("connected to Kafka admin");

  const existing = await admin.listTopics();
  log.info({ existing }, "current topics");

  const toCreate = TOPIC_CONFIGS.filter((t) => !existing.includes(t.topic));

  if (toCreate.length === 0) {
    log.info("all topics already exist");
  } else {
    await admin.createTopics({ topics: toCreate });
    log.info({ created: toCreate.map((t) => t.topic) }, "topics created");
  }

  await admin.disconnect();
}

main().catch((err) => {
  log.fatal({ err }, "topic setup failed");
  process.exit(1);
});
