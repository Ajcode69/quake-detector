/**
 * Postgres connection pool (Supabase-compatible).
 * Uses node-postgres (pg) — raw SQL for full PostGIS control.
 */

import pg from "pg";
import { config } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("db");

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  log.error({ err }, "unexpected idle-client error");
});

/**
 * Run a single query.
 * @param {string} text  - SQL with $1, $2 placeholders
 * @param {any[]}  params
 */
export async function query(text, params = []) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;

  if (duration > 500) {
    log.warn({ duration, text: text.slice(0, 80) }, "slow query");
  }

  return result;
}

/**
 * Get a client from the pool for transactions.
 */
export async function getClient() {
  return pool.connect();
}

/**
 * Graceful shutdown.
 */
export async function closePool() {
  await pool.end();
  log.info("database pool closed");
}

export { pool };
