/**
 * Consumer: event-persister
 * Reads earthquake.raw → broadcasts to SSE clients filtered by their registered locations.
 *
 * Each SSE client registers with locationIds (their monitored locations).
 * On each event, we check proximity against only those locations.
 * If no locations are registered, the client gets ALL events (global view).
 */

import { createLogger } from "../../../../shared/logger.js";
import { TOPICS } from "../../../../shared/kafka/topics.js";
import { getLocationsByIds } from "../services/location.service.js";

const log = createLogger("consumer:persister");

/**
 * SSE client registry.
 * Each entry: { res, locations: [{ id, lat, lon, radiusKm }] | null }
 *
 * - If locations is null → client sees ALL events (admin/global view)
 * - If locations is [] → client registered but has no locations (sees nothing)
 * - If locations is [{...}] → client sees only events within radius of their locations
 */
export const sseClients = new Map(); // clientId → { res, locations }

let clientIdCounter = 0;

/**
 * Register an SSE client. Returns a clientId for cleanup.
 * @param {Response} res - Express response object
 * @param {number[]|null} locationIds - IDs from user_locations table, or null for global view
 * @returns {string} clientId
 */
export async function registerSSEClient(res, locationIds) {
  const clientId = String(++clientIdCounter);
  let locations = null;

  if (locationIds && locationIds.length > 0) {
    const rows = await getLocationsByIds(locationIds);
    locations = rows.map((r) => ({
      id: r.id,
      lat: parseFloat(r.latitude),
      lon: parseFloat(r.longitude),
      radiusKm: r.radiusKm,
    }));
  }

  sseClients.set(clientId, { res, locations });
  log.info({ clientId, locationCount: locations?.length ?? "global" }, "SSE client registered");
  return clientId;
}

/**
 * Remove an SSE client.
 */
export function removeSSEClient(clientId) {
  sseClients.delete(clientId);
}

/**
 * Broadcast a risk score update to ALL SSE clients.
 * Risk scores are per-location, so every connected client receives them
 * (the frontend filters by its own locationIds).
 */
export function broadcastRiskUpdate(payload) {
  for (const [clientId, client] of sseClients) {
    try {
      client.res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {
      sseClients.delete(clientId);
    }
  }
}

/**
 * Broadcast an event to SSE clients, filtered by their locations.
 */
function broadcastToSSE(event) {
  const eventLon = parseFloat(event.longitude) || parseFloat(event.geometry?.coordinates?.[0]);
  const eventLat = parseFloat(event.latitude) || parseFloat(event.geometry?.coordinates?.[1]);

  for (const [clientId, client] of sseClients) {
    try {
      // No locations = global view → send everything
      if (client.locations === null) {
        client.res.write(`data: ${JSON.stringify(event)}\n\n`);
        continue;
      }

      // Has locations → check if event is within any of their radii
      if (client.locations.length === 0) continue; // no locations registered

      const isNearby = client.locations.some((loc) => {
        const distKm = haversineKm(eventLat, eventLon, loc.lat, loc.lon);
        return distKm <= loc.radiusKm;
      });

      if (isNearby) {
        client.res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch {
      sseClients.delete(clientId);
    }
  }
}

/**
 * Haversine distance in km — fast, no DB call needed for SSE filtering.
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Start the persister consumer.
 * @param {import('kafkajs').Consumer} consumer
 */
export async function startPersister(consumer) {
  await consumer.subscribe({ topic: TOPICS.RAW, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const event = JSON.parse(message.value.toString());

        // Skip backfill events for SSE broadcast
        if (event._backfill) return;

        broadcastToSSE(event);

        log.debug({ id: event.id, mag: event.mag }, "event processed for SSE");
      } catch (err) {
        log.error({ err }, "persister failed to process message");
      }
    },
  });

  log.info("persister consumer running");
}
