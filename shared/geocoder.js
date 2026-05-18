/**
 * Geocoding utility — wraps Nominatim (OpenStreetMap) with rate limiting.
 * Free, no API key. Nominatim TOS: max 1 req/sec, identify your app via User-Agent.
 */

import { createLogger } from "./logger.js";

const log = createLogger("geocoder");

const NOMINATIM_URL = "https://nominatim.openstreetmap.org";
const USER_AGENT = "QuakeDetector/1.0 (earthquake-monitor)";

// Simple rate limiter — enforce 1 req/sec
let lastRequest = 0;

async function rateLimitedFetch(url) {
  const now = Date.now();
  const elapsed = now - lastRequest;
  if (elapsed < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - elapsed));
  }
  lastRequest = Date.now();

  return fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
}

/**
 * Search for locations by query string.
 * Returns up to 5 results with lat/lon and display name.
 *
 * @param {string} query - e.g. "Tokyo", "San Francisco", "Delhi"
 * @returns {Promise<Array<{ displayName: string, lat: number, lon: number, type: string, importance: number }>>}
 */
export async function searchLocations(query) {
  if (!query || query.trim().length < 2) return [];

  const url = `${NOMINATIM_URL}/search?` +
    new URLSearchParams({
      q: query,
      format: "json",
      limit: "5",
      addressdetails: "1",
      "accept-language": "en",
    });

  try {
    const res = await rateLimitedFetch(url);
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);

    const data = await res.json();

    return data.map((item) => ({
      displayName: item.display_name,
      shortName: buildShortName(item),
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon),
      type: item.type,
      importance: item.importance,
      boundingBox: item.boundingbox?.map(Number),
    }));
  } catch (err) {
    log.error({ err, query }, "geocoding failed");
    return [];
  }
}

/**
 * Reverse geocode — lat/lon → place name.
 */
export async function reverseGeocode(lat, lon) {
  const url = `${NOMINATIM_URL}/reverse?` +
    new URLSearchParams({
      lat: String(lat),
      lon: String(lon),
      format: "json",
      "accept-language": "en",
    });

  try {
    const res = await rateLimitedFetch(url);
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);

    const data = await res.json();
    return {
      displayName: data.display_name,
      shortName: buildShortName(data),
      lat: parseFloat(data.lat),
      lon: parseFloat(data.lon),
    };
  } catch (err) {
    log.error({ err, lat, lon }, "reverse geocoding failed");
    return null;
  }
}

/**
 * Build a short readable name from Nominatim address details.
 * e.g. "Tokyo, Japan" instead of "Tokyo, Kantō, Japan"
 */
function buildShortName(item) {
  const addr = item.address || {};
  const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || "";
  const state = addr.state || "";
  const country = addr.country || "";

  if (city && country) return `${city}, ${country}`;
  if (state && country) return `${state}, ${country}`;
  if (country) return country;
  return item.display_name?.split(",").slice(0, 2).join(",").trim() || "Unknown";
}
