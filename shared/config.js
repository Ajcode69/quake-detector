/**
 * Centralised config — single source of truth.
 * Every module imports from here.
 */

import "dotenv/config";

export const config = {
  // ── Postgres (Supabase) ───────────────────────────────────
  databaseUrl: process.env.DATABASE_URL,

  // ── Kafka (Redpanda) ─────────────────────────────────────
  kafkaBrokers: (process.env.KAFKA_BROKERS || "localhost:9092").split(","),
  kafkaSaslUsername: process.env.KAFKA_SASL_USERNAME || null,
  kafkaSaslPassword: process.env.KAFKA_SASL_PASSWORD || null,
  kafkaSsl: process.env.KAFKA_SSL === "true",

  // ── Telegram ─────────────────────────────────────────────
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || "",

  // ── USGS ─────────────────────────────────────────────────
  usgsFeedUrl:
    process.env.USGS_FEED_URL ||
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson",
  usgsBackfillUrl:
    process.env.USGS_BACKFILL_URL ||
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson",
  pollIntervalSec: parseInt(process.env.POLL_INTERVAL_SEC || "60", 10),

  // ── App ──────────────────────────────────────────────────
  port: parseInt(process.env.PORT || "3000", 10),
  logLevel: process.env.LOG_LEVEL || "info",
  nodeEnv: process.env.NODE_ENV || "development",
};
