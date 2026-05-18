/**
 * Health service for the API.
 */

import prisma from "../../../../shared/db/client.js";

/**
 * Get system health: latest poll, stats, history.
 */
export async function getHealth() {
  const [history, counts] = await Promise.all([
    prisma.pollHealth.findMany({
      orderBy: { polledAt: "desc" },
      take: 10,
    }),

    prisma.$queryRaw`
      SELECT
        (SELECT COUNT(*)::int FROM earthquakes) AS "totalEvents",
        (SELECT COUNT(*)::int FROM earthquakes WHERE ingested_at > NOW() - INTERVAL '1 hour') AS "eventsLastHour",
        (SELECT COUNT(*)::int FROM alerts_log WHERE created_at > NOW() - INTERVAL '24 hours') AS "alerts24h",
        (SELECT COUNT(*)::int FROM alerts_log WHERE sent = FALSE) AS "unsentAlerts"
    `,
  ]);

  const latest = history[0];

  return {
    status: latest?.status === "success" ? "healthy" : "degraded",
    lastPoll: latest ?? null,
    stats: counts[0],
    history,
  };
}
