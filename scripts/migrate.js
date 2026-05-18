/**
 * Run Prisma migrations against the database.
 * Also runs raw SQL for PostGIS extension + indexes that Prisma can't manage.
 *
 * Usage:  npm run migrate
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import prisma from "../shared/db/client.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("migrate");
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  // 1. Run Prisma's managed migration (schema push for dev)
  log.info("prisma schema push is handled via: npx prisma db push");

  // 2. Run any raw SQL migrations for PostGIS features Prisma can't handle
  const migrationsDir = path.join(__dirname, "..", "shared", "db", "migrations");

  if (fs.existsSync(migrationsDir)) {
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      log.info({ file }, "applying raw SQL migration");

      try {
        await prisma.$executeRawUnsafe(sql);
        log.info({ file }, "migration applied");
      } catch (err) {
        // Ignore "already exists" errors for idempotent migrations
        if (err.message?.includes("already exists")) {
          log.info({ file }, "migration already applied, skipping");
        } else {
          log.error({ err, file }, "migration failed");
          throw err;
        }
      }
    }
  }

  log.info("all migrations complete");
  await prisma.$disconnect();
}

main().catch((err) => {
  log.fatal({ err }, "migration runner crashed");
  process.exit(1);
});
