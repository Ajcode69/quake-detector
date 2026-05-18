/**
 * Health routes — system observability.
 */

import { Router } from "express";
import { getHealthHistory } from "../../../../shared/db/queries.js";
import { query } from "../../../../shared/db/connection.js";

const router = Router();

/**
 * GET /api/health
 * Returns current system health + recent poll history.
 */
router.get("/", async (req, res) => {
  try {
    const history = await getHealthHistory(10);
    const latest = history[0];

    // Count total events and events in last hour
    const stats = await query(`
      SELECT
        (SELECT COUNT(*) FROM earthquakes) AS total_events,
        (SELECT COUNT(*) FROM earthquakes WHERE ingested_at > NOW() - INTERVAL '1 hour') AS events_last_hour,
        (SELECT COUNT(*) FROM alerts_log WHERE created_at > NOW() - INTERVAL '24 hours') AS alerts_24h,
        (SELECT COUNT(*) FROM alerts_log WHERE sent = FALSE) AS unsent_alerts
    `);

    res.json({
      status: latest?.status === "success" ? "healthy" : "degraded",
      lastPoll: latest || null,
      stats: stats.rows[0],
      history,
    });
  } catch (err) {
    req.log.error({ err }, "health check failed");
    res.status(500).json({ status: "unhealthy", error: err.message });
  }
});

export default router;
