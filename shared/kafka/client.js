/**
 * KafkaJS client factory — configured for Redpanda (Kafka-compatible).
 * Shared between ingestion (producer) and api (consumers).
 */

import { Kafka, logLevel as KafkaLogLevel } from "kafkajs";
import { config } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("kafka");

/**
 * Map our log levels to kafkajs log levels.
 */
const toKafkaLogLevel = {
  error: KafkaLogLevel.ERROR,
  warn: KafkaLogLevel.WARN,
  info: KafkaLogLevel.INFO,
  debug: KafkaLogLevel.DEBUG,
};

/**
 * Build the Kafka client — handles both local Redpanda and Redpanda Cloud (SASL).
 * @param {string} clientId - unique per process, e.g. 'ingestion-worker' or 'api-server'
 */
export function createKafkaClient(clientId) {
  const kafkaConfig = {
    clientId,
    brokers: config.kafkaBrokers,
    logLevel: toKafkaLogLevel[config.logLevel] || KafkaLogLevel.WARN,
    logCreator:
      () =>
      ({ log: entry }) => {
        const { message, ...extra } = entry;
        log.debug({ ...extra }, message);
      },
    // Retry config — critical for reliability
    retry: {
      initialRetryTime: 300,
      retries: 8,
    },
  };

  // Redpanda Cloud uses SASL + SSL
  if (config.kafkaSaslUsername) {
    kafkaConfig.ssl = true;
    kafkaConfig.sasl = {
      mechanism: "scram-sha-256",
      username: config.kafkaSaslUsername,
      password: config.kafkaSaslPassword,
    };
  }

  return new Kafka(kafkaConfig);
}
