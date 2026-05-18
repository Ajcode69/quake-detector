/**
 * Location routes — register and manage monitored locations.
 */

import { Router } from "express";
import { query } from "../../../../shared/db/connection.js";

const router = Router();

/**
 * GET /api/locations
 * Returns all registered locations for a given Telegram chat.
 * Query params: chatId (required)
 */
router.get("/", async (req, res) => {
  try {
    const { chatId } = req.query;
    if (!chatId) {
      return res.status(400).json({ error: "chatId query param is required" });
    }

    const result = await query(
      `SELECT id, label, latitude, longitude, radius_km, created_at
       FROM user_locations
       WHERE telegram_chat_id = $1
       ORDER BY created_at DESC`,
      [chatId]
    );

    res.json({ data: result.rows });
  } catch (err) {
    req.log.error({ err }, "failed to fetch locations");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/locations
 * Register a new monitored location.
 * Body: { label, latitude, longitude, radiusKm, telegramChatId }
 */
router.post("/", async (req, res) => {
  try {
    const { label, latitude, longitude, radiusKm = 500, telegramChatId } = req.body;

    if (!label || latitude == null || longitude == null || !telegramChatId) {
      return res.status(400).json({
        error: "Required: label, latitude, longitude, telegramChatId",
      });
    }

    const result = await query(
      `INSERT INTO user_locations (label, latitude, longitude, geog, radius_km, telegram_chat_id)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, $4, $5)
       RETURNING id, label, latitude, longitude, radius_km, created_at`,
      [label, latitude, longitude, radiusKm, telegramChatId]
    );

    res.status(201).json({ data: result.rows[0] });
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
    await query("DELETE FROM user_locations WHERE id = $1", [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "failed to delete location");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
