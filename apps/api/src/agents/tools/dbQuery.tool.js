/**
 * Read-only SQL query tool backed by the schema registry.
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import prisma from "../../../../../shared/db/client.js";
import { createLogger } from "../../../../../shared/logger.js";
import { getRegistrySummary, validateSql } from "../schema-registry/index.js";

const log = createLogger("agent:db-query");

const QUERY_TIMEOUT_MS = 5000;

export const dbQueryTool = tool(
  async ({ sql, purpose }) => {
    log.info({ purpose, sqlPreview: sql.slice(0, 120) }, "db query started");

    const validation = validateSql(sql);
    if (!validation.valid) {
      return JSON.stringify({ error: validation.error });
    }

    const start = Date.now();

    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Query timeout (5s)")), QUERY_TIMEOUT_MS)
      );

      const queryPromise = prisma.$queryRawUnsafe(validation.sql);
      const rows = await Promise.race([queryPromise, timeoutPromise]);

      const serialized = JSON.parse(
        JSON.stringify(rows, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value
        )
      );

      log.info(
        { purpose, rowCount: Array.isArray(serialized) ? serialized.length : 0, durationMs: Date.now() - start },
        "db query done"
      );

      return JSON.stringify({ rows: serialized, rowCount: Array.isArray(serialized) ? serialized.length : 0 });
    } catch (err) {
      log.warn({ err, purpose }, "db query failed");
      return JSON.stringify({ error: "Query failed. Check SQL syntax and allowed tables." });
    }
  },
  {
    name: "db_query",
    description: `Run a read-only SELECT query against the QuakeDetector database. Only SELECT is allowed. Results are capped at 50 rows.

For spatial/distance queries (near a point, within radius, proximity counts), use postgis_query instead — it runs parameterized PostGIS ST_DWithin/ST_Distance on earthquakes.geog.

Available schema:
${getRegistrySummary()}`,
    schema: z.object({
      sql: z.string().describe("A SELECT SQL query using only allowed tables"),
      purpose: z.string().describe("Brief description of why this query is needed"),
    }),
  }
);
