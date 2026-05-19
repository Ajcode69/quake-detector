/**
 * Shared Prisma client singleton.
 * Both processes (ingestion + api) import from here.
 */

import "dotenv/config";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createLogger } from "../logger.js";

const log = createLogger("db");

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({
  adapter,
  log:
    process.env.NODE_ENV === "development"
      ? [
          { emit: "event", level: "query" },
          { emit: "event", level: "warn" },
          { emit: "event", level: "error" },
        ]
      : [{ emit: "event", level: "error" }],
});

// Log slow queries in dev
prisma.$on("query", (e) => {
  if (e.duration > 500) {
    log.warn({ duration: e.duration, query: e.query.slice(0, 100) }, "slow query");
  }
});

prisma.$on("error", (e) => {
  log.error({ message: e.message }, "prisma error");
});

/**
 * Graceful shutdown.
 */
export async function disconnect() {
  await prisma.$disconnect();
  log.info("prisma disconnected");
}

export default prisma;
