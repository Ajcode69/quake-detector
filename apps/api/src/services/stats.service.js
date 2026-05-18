/**
 * Stats service — aggregated KPIs for the dashboard.
 * Powers the top KPI strip in the World View module.
 */

import prisma from "../../../../shared/db/client.js";
import { createLogger } from "../../../../shared/logger.js";

const log = createLogger("service:stats");

// Time window → interval mapping
const WINDOW_MAP = {
  "1h": "1 hour",
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

/**
 * Get aggregated stats for the dashboard KPI strip.
 * @param {string} timeWindow - '1h', '24h', '7d', '30d'
 */
export async function getEventStats(timeWindow = "24h") {
  const interval = WINDOW_MAP[timeWindow] || "24 hours";

  try {
    const [stats, regionStats, pollStatus] = await Promise.all([
      // Core aggregates
      prisma.$queryRawUnsafe(`
        SELECT
          COUNT(*)::int AS "totalEvents",
          COUNT(CASE WHEN mag >= 5.0 OR alert IN ('orange','red') THEN 1 END)::int AS "highSeverityEvents",
          COUNT(CASE WHEN tsunami = 1 THEN 1 END)::int AS "tsunamiWarnings",
          COALESCE(MAX(mag), 0)::float AS "maxMag",
          COALESCE(ROUND(AVG(mag)::numeric, 1), 0)::float AS "avgMag",
          COALESCE(ROUND(AVG(depth)::numeric, 1), 0)::float AS "avgDepth",
          COUNT(CASE WHEN mag >= 4.0 THEN 1 END)::int AS "significant4Plus",
          COUNT(CASE WHEN mag >= 6.0 THEN 1 END)::int AS "majorEvents"
        FROM earthquakes
        WHERE event_time > NOW() - INTERVAL '${interval}'
      `),

      // Most active region (extract region from place string)
      prisma.$queryRawUnsafe(`
        SELECT 
          COALESCE(
            CASE 
              WHEN place LIKE '%of %' THEN SUBSTRING(place FROM 'of (.+)$')
              ELSE place 
            END,
            'Unknown'
          ) AS region,
          COUNT(*)::int AS count
        FROM earthquakes
        WHERE event_time > NOW() - INTERVAL '${interval}'
          AND place IS NOT NULL
        GROUP BY region
        ORDER BY count DESC
        LIMIT 1
      `),

      // Latest poll health
      prisma.pollHealth.findFirst({
        orderBy: { polledAt: "desc" },
        select: { status: true, polledAt: true, responseMs: true },
      }),
    ]);

    const s = stats[0] || {};
    const topRegion = regionStats[0] || { region: "N/A", count: 0 };

    return {
      totalEvents: s.totalEvents || 0,
      highSeverityEvents: s.highSeverityEvents || 0,
      tsunamiWarnings: s.tsunamiWarnings || 0,
      maxMag: s.maxMag || 0,
      avgMag: s.avgMag || 0,
      avgDepth: s.avgDepth || 0,
      significant4Plus: s.significant4Plus || 0,
      majorEvents: s.majorEvents || 0,
      mostActiveRegion: topRegion.region,
      mostActiveRegionCount: topRegion.count,
      feedStatus: pollStatus?.status === "success" ? "live" : (pollStatus?.status || "unknown"),
      lastSuccessfulPoll: pollStatus?.polledAt || null,
      lastPollResponseMs: pollStatus?.responseMs || null,
      timeWindow,
    };
  } catch (err) {
    log.error({ err }, "failed to compute event stats");
    throw err;
  }
}
