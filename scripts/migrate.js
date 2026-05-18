/**
 * Run database migrations against Supabase/Postgres.
 * Usage:  npm run migrate
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { query, closePool } from "../shared/db/connection.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("migrate");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const migrationsDir = path.join(__dirname, "..", "shared", "db", "migrations");
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

  log.info({ count: files.length }, "running migrations");

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    log.info({ file }, "applying migration");

    try {
      await query(sql);
      log.info({ file }, "migration applied");
    } catch (err) {
      log.error({ err, file }, "migration failed");
      throw err;
    }
  }

  log.info("all migrations complete");
  await closePool();
}

main().catch((err) => {
  log.fatal({ err }, "migration runner crashed");
  process.exit(1);
});
