/**
 * Geocode route — proxies Nominatim through our API.
 * Why proxy: avoids CORS issues from the browser, enforces rate limiting server-side,
 * and lets us cache results later.
 */

import { Router } from "express";
import { searchLocations, reverseGeocode } from "../../../../shared/geocoder.js";

const router = Router();

/**
 * GET /api/geocode?q=Tokyo
 * Returns up to 5 location suggestions with lat/lon.
 */
router.get("/", async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.json({ data: [] });
    }

    const results = await searchLocations(q);
    res.json({ data: results });
  } catch (err) {
    req.log.error({ err }, "geocode search failed");
    res.status(500).json({ error: "Geocoding failed" });
  }
});

/**
 * GET /api/geocode/reverse?lat=35.68&lon=139.69
 * Returns place name for coordinates.
 */
router.get("/reverse", async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (lat == null || lon == null) {
      return res.status(400).json({ error: "lat and lon are required" });
    }

    const result = await reverseGeocode(parseFloat(lat), parseFloat(lon));
    res.json({ data: result });
  } catch (err) {
    req.log.error({ err }, "reverse geocode failed");
    res.status(500).json({ error: "Reverse geocoding failed" });
  }
});

export default router;
