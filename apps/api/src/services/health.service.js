/**
 * Health service for the API.
 */

import { config } from "../../../../shared/config.js";
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

  // Compute consecutive failures from retrieved history
  let consecutiveFailures = 0;
  for (const p of history) {
    if (p.status !== "success") consecutiveFailures++;
    else break;
  }

  // Calculate the expected backoff based on the consecutive failures
  const pollIntervalSec = config.pollIntervalSec || 60;
  const backoffSec = consecutiveFailures === 0
    ? pollIntervalSec
    : Math.min(pollIntervalSec * Math.pow(2, consecutiveFailures), 600);
  const gracePeriodSec = 120; // 2 minutes grace period

  const isOffline = latest
    ? (Date.now() - new Date(latest.polledAt).getTime() > (backoffSec + gracePeriodSec) * 1000)
    : true;

  let status = "healthy";
  if (isOffline) {
    status = "offline";
  } else if (latest?.status !== "success") {
    status = "degraded";
  }

  return {
    status,
    lastPoll: latest ?? null,
    stats: counts[0],
    history,
  };
}
