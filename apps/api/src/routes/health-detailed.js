/**
 * Detailed health routes — extended system observability for the System Health module.
 */

import { Router } from "express";
import prisma from "../../../../shared/db/client.js";

const router = Router();

/**
 * GET /api/health/detailed
 */
router.get("/", async (req, res) => {
  try {
    const [
      pollHistory,
      backfillStatus,
      alertStats,
      eventThroughput,
      dedupStats,
      recentErrors,
    ] = await Promise.all([
      // Last 60 polls for timeline
      prisma.pollHealth.findMany({
        orderBy: { polledAt: "desc" },
        take: 60,
      }),

      // Latest backfill
      prisma.backfillLog.findFirst({
        orderBy: { startedAt: "desc" },
      }),

      // Alert queue stats
      prisma.$queryRaw`
        SELECT
          COUNT(CASE WHEN sent = true AND created_at > NOW() - INTERVAL '24 hours' THEN 1 END)::int AS "sentLast24h",
          COUNT(CASE WHEN sent = false AND created_at > NOW() - INTERVAL '24 hours' THEN 1 END)::int AS "failedLast24h",
          COUNT(CASE WHEN sent = false THEN 1 END)::int AS "retryPending",
          COUNT(CASE WHEN created_at > NOW() - INTERVAL '24 hours' THEN 1 END)::int AS "totalLast24h"
        FROM alerts_log
      `,

      // Events per minute throughput (last hour)
      prisma.$queryRaw`
        SELECT
          date_trunc('minute', ingested_at) AS minute,
          COUNT(*)::int AS count
        FROM earthquakes
        WHERE ingested_at > NOW() - INTERVAL '1 hour'
        GROUP BY minute
        ORDER BY minute ASC
      `,

      // Dedup stats
      prisma.$queryRaw`
        SELECT
          (SELECT COUNT(*)::int FROM event_revisions) AS "totalRevisions",
          (SELECT COUNT(*)::int FROM event_revisions WHERE revised_at > NOW() - INTERVAL '24 hours') AS "revisions24h"
      `,

      // Recent errors
      prisma.pollHealth.findMany({
        where: { status: { not: "success" } },
        orderBy: { polledAt: "desc" },
        take: 20,
      }),
    ]);

    // Compute poll success rate (last hour)
    const pollsLastHour = pollHistory.filter(
      (p) => new Date(p.polledAt).getTime() > Date.now() - 3600_000
    );
    const successCount = pollsLastHour.filter((p) => p.status === "success").length;
    const pollSuccessRate1h = pollsLastHour.length > 0
      ? Math.round((successCount / pollsLastHour.length) * 1000) / 10
      : 100;

    const latestPoll = pollHistory[0] || null;
    const avgResponseMs = pollsLastHour.length > 0
      ? Math.round(
          pollsLastHour.reduce((s, p) => s + (p.responseMs || 0), 0) / pollsLastHour.length
        )
      : 0;

    // Consecutive failures
    let consecutiveFailures = 0;
    for (const p of pollHistory) {
      if (p.status !== "success") consecutiveFailures++;
      else break;
    }

    res.json({
      ingestion: {
        status: latestPoll?.status === "success" ? "running" : "degraded",
        lastPoll: latestPoll,
        pollSuccessRate1h,
        avgResponseMs,
        consecutiveFailures,
        totalPollsTracked: pollHistory.length,
      },
      backfill: {
        status: backfillStatus?.status || "not_started",
        lastRun: backfillStatus || null,
        eventsTotal: backfillStatus?.eventsTotal || 0,
        eventsUpserted: backfillStatus?.eventsUpserted || 0,
      },
      polling: {
        history: pollHistory.map((p) => ({
          timestamp: p.polledAt,
          status: p.status,
          eventsFetched: p.eventsFetched,
          newEvents: p.newEvents,
          revisions: p.revisions,
          responseMs: p.responseMs,
          error: p.errorMessage,
        })),
        throughput: eventThroughput.map((t) => ({
          minute: t.minute,
          count: t.count,
        })),
      },
      dedup: dedupStats[0] || { totalRevisions: 0, revisions24h: 0 },
      alerts: alertStats[0] || { sentLast24h: 0, failedLast24h: 0, retryPending: 0, totalLast24h: 0 },
      recentErrors: recentErrors.map((e) => ({
        timestamp: e.polledAt,
        status: e.status,
        error: e.errorMessage,
        responseMs: e.responseMs,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "detailed health check failed");
    res.status(500).json({ status: "unhealthy", error: err.message });
  }
});

export default router;
