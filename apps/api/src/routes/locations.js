/**
 * Location routes — register and manage monitored locations.
 */

import { Router } from "express";
import { createLocation, getLocations, deleteLocation } from "../services/location.service.js";
import { invalidateLocationCache } from "../services/location.cache.js";
import { calculateAndSaveLocationRisk } from "../services/risk.service.js";
import {
  discoverCriticalContacts,
  getContactsForLocation,
  isContactDiscoveryConfigured,
} from "../agents/index.js";
import prisma from "../../../../shared/db/client.js";

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

    // Fire-and-forget: discover emergency alert contacts
    discoverCriticalContacts({ location }).catch((err) =>
      req.log.error({ err, locationId: location.id }, "contact discovery failed")
    );

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
 * GET /api/locations/:id/contacts
 */
router.get("/:id/contacts", async (req, res) => {
  try {
    const locationId = parseInt(req.params.id);
    const location = await prisma.userLocation.findUnique({
      where: { id: locationId },
      select: { id: true },
    });

    if (!location) {
      return res.status(404).json({ error: "Location not found" });
    }

    const contacts = await getContactsForLocation(locationId);
    res.json({
      data: contacts,
      configured: isContactDiscoveryConfigured(),
    });
  } catch (err) {
    req.log.error({ err }, "failed to fetch location contacts");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/locations/:id/contacts/discover
 * Re-run agent contact discovery for a location.
 */
router.post("/:id/contacts/discover", async (req, res) => {
  try {
    const locationId = parseInt(req.params.id);
    const location = await prisma.userLocation.findUnique({
      where: { id: locationId },
    });

    if (!location) {
      return res.status(404).json({ error: "Location not found" });
    }

    if (!isContactDiscoveryConfigured()) {
      return res.status(503).json({ error: "Contact discovery is not configured" });
    }

    discoverCriticalContacts({ location }).catch((err) =>
      req.log.error({ err, locationId }, "contact discovery failed")
    );

    res.status(202).json({ success: true, message: "Contact discovery started" });
  } catch (err) {
    req.log.error({ err }, "failed to start contact discovery");
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
