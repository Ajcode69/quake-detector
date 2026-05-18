/**
 * Shared Prisma client singleton.
 * Both processes (ingestion + api) import from here.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createLogger } from "../logger.js";

const log = createLogger("db");

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
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
