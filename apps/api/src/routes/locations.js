/**
 * Location routes — register and manage monitored locations.
 */

import { Router } from "express";
import { createLocation, getLocations, deleteLocation } from "../services/location.service.js";
import { invalidateLocationCache } from "../services/location.cache.js";

const router = Router();

/**
 * GET /api/locations?chatId=123
 */
router.get("/", async (req, res) => {
  try {
    const { chatId } = req.query;
    if (!chatId) return res.status(400).json({ error: "chatId query param is required" });

    const locations = await getLocations(chatId);
    res.json({ data: locations });
  } catch (err) {
    req.log.error({ err }, "failed to fetch locations");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/locations
 * Body: { label, latitude, longitude, radiusKm, telegramChatId }
 */
router.post("/", async (req, res) => {
  try {
    const { label, latitude, longitude, radiusKm = 500, telegramChatId } = req.body;

    if (!label || latitude == null || longitude == null || !telegramChatId) {
      return res.status(400).json({ error: "Required: label, latitude, longitude, telegramChatId" });
    }

    const location = await createLocation({ label, latitude, longitude, radiusKm, telegramChatId });
    await invalidateLocationCache();
    res.status(201).json({ data: location });
  } catch (err) {
    req.log.error({ err }, "failed to create location");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /api/locations/:id
 */
router.delete("/:id", async (req, res) => {
  try {
    await deleteLocation(parseInt(req.params.id));
    await invalidateLocationCache();
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "failed to delete location");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
