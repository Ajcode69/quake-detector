/**
 * Health routes — system observability.
 */

import { Router } from "express";
import { getHealth } from "../services/health.service.js";

const router = Router();

/**
 * GET /api/health
 */
router.get("/", async (req, res) => {
  try {
    const health = await getHealth();
    res.json(health);
  } catch (err) {
    req.log.error({ err }, "health check failed");
    res.status(500).json({ status: "unhealthy", error: err.message });
  }
});

export default router;
