/**
 * Stats routes — aggregated KPIs for the dashboard.
 */

import { Router } from "express";
import { getEventStats } from "../services/stats.service.js";

const router = Router();

/**
 * GET /api/stats?timeWindow=24h
 */
router.get("/", async (req, res) => {
  try {
    const { timeWindow = "24h" } = req.query;
    const stats = await getEventStats(timeWindow);
    res.json(stats);
  } catch (err) {
    req.log.error({ err }, "failed to fetch stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
