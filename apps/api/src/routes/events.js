

import { Router } from "express";
import { getEvents, getEventById } from "../services/earthquake.service.js";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { limit = 50, offset = 0, minMag, since, locations, timeWindow, alertLevel, region, orderBy } = req.query;

    const locationIds = locations
      ? locations.split(",").map(Number).filter(Boolean)
      : undefined;

    let computedSince = since;
    if (!computedSince && timeWindow) {
      const now = Date.now();
      if (timeWindow === "1h") computedSince = new Date(now - 3600_000).toISOString();
      else if (timeWindow === "24h") computedSince = new Date(now - 86400_000).toISOString();
      else if (timeWindow === "7d") computedSince = new Date(now - 7 * 86400_000).toISOString();
      else if (timeWindow === "30d") computedSince = new Date(now - 30 * 86400_000).toISOString();
    }

    const events = await getEvents({
      limit: Math.min(parseInt(limit), 200),
      offset: parseInt(offset),
      minMag: minMag ? parseFloat(minMag) : undefined,
      since: computedSince || undefined,
      locationIds,
      alertLevel,
      region,
      orderBy,
    });

    res.json({ data: events, count: events.length });
  } catch (err) {
    req.log.error({ err }, "failed to fetch events");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/events/:id
 * Returns event + revision history.
 */
router.get("/:id", async (req, res) => {
  try {
    const event = await getEventById(req.params.id);
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.json({ data: event, revisions: event.revisions });
  } catch (err) {
    req.log.error({ err }, "failed to fetch event");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
