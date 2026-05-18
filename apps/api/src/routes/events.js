/**
 * Events routes — CRUD for earthquake data.
 */

import { Router } from "express";
import { getEvents, getEventById } from "../../../../shared/db/queries.js";

const router = Router();

/**
 * GET /api/events
 * Query params: limit, offset, minMag, since (ISO string)
 */
router.get("/", async (req, res) => {
  try {
    const { limit = 50, offset = 0, minMag, since } = req.query;

    const events = await getEvents({
      limit: Math.min(parseInt(limit), 200),
      offset: parseInt(offset),
      minMag: minMag ? parseFloat(minMag) : null,
      since: since || null,
    });

    res.json({ data: events, count: events.length });
  } catch (err) {
    req.log.error({ err }, "failed to fetch events");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/events/:id
 * Returns event + its revision history.
 */
router.get("/:id", async (req, res) => {
  try {
    const { event, revisions } = await getEventById(req.params.id);

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    res.json({ data: event, revisions });
  } catch (err) {
    req.log.error({ err }, "failed to fetch event");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
