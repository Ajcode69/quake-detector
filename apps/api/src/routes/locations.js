/**
 * Location routes — register and manage monitored locations.
 */

import { Router } from "express";
import { createLocation, getLocations, deleteLocation } from "../services/location.service.js";
import { invalidateLocationCache } from "../services/location.cache.js";
import { calculateAndSaveLocationRisk } from "../services/risk.service.js";

const router = Router();

/**
 * GET /api/locations?chatId=123
 */
router.get("/", async (req, res) => {
  try {
    const { chatId } = req.query;
    // We ignore chatId and fetch for the requested user (fallback to admin userId = 1)
    const userId = req.headers["x-user-id"] ? parseInt(req.headers["x-user-id"]) : 1;
    const locations = await getLocations(userId);
    
    // For backward compatibility, map a mock telegramChatId
    const serialized = locations.map(loc => ({
      ...loc,
      telegramChatId: chatId ? chatId.toString() : "1"
    }));

    res.json({ data: serialized });
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

    if (!label || latitude == null || longitude == null) {
      return res.status(400).json({ error: "Required: label, latitude, longitude" });
    }

    // Pass dynamic userId to createLocation
    const userId = req.headers["x-user-id"] ? parseInt(req.headers["x-user-id"]) : 1;
    const location = await createLocation({ label, latitude, longitude, radiusKm, userId });
    
    // Synchronously calculate and save initial risk score
    try {
      await calculateAndSaveLocationRisk(location);
    } catch (riskErr) {
      req.log.error({ err: riskErr, locationId: location.id }, "failed to calculate initial risk score on creation");
    }

    await invalidateLocationCache();
    res.status(201).json({
      data: {
        ...location,
        telegramChatId: telegramChatId ? telegramChatId.toString() : "1",
      }
    });
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
