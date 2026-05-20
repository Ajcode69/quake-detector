/**
 * Location service — CRUD for user-monitored locations.
 */

import prisma from "../../../../shared/db/client.js";
import { computeAllScoresForLocation } from "./risk.service.js";


export async function createLocation({ label, latitude, longitude, radiusKm = 500, userId = 1 }) {
  const location = await prisma.userLocation.create({
    data: {
      label,
      latitude,
      longitude,
      radiusKm,
      userId: parseInt(userId),
    },
  });

  // Set PostGIS geog column
  await prisma.$executeRaw`
    UPDATE user_locations
    SET geog = ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
    WHERE id = ${location.id}
  `;

  return location;
}

/**
 * Get all locations for a User.
 */
export async function getLocations(userId = 1) {
  const locations = await prisma.userLocation.findMany({
    where: { userId: parseInt(userId) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      label: true,
      latitude: true,
      longitude: true,
      radiusKm: true,
      createdAt: true,
    },
  });

  // Calculate fresh scores on the fly concurrently
  const mappedLocations = await Promise.all(
    locations.map(async (loc) => {
      try {
        const freshScores = await computeAllScoresForLocation(loc);

        // Async background write to DB so it doesn't hamper HTTP latency
        prisma.locationRiskScore.create({
          data: {
            locationId: loc.id,
            staticScore: freshScores.staticScore,
            deltaScore: freshScores.deltaScore,
            postEventScore: freshScores.postEventScore,
            displayedRisk: freshScores.displayedRisk,
            riskLevel: freshScores.riskLevel,
            triggerEventId: freshScores.triggerEventId,
            aftershockWindowActive: freshScores.aftershockWindowActive,
            expectedAftershockMag: freshScores.expectedAftershockMag,
            eventsInRadius1h: freshScores.eventsInRadius1h,
            eventsInRadius24h: freshScores.eventsInRadius24h,
            largestMag24h: freshScores.largestMag24h,
          },
        }).catch((err) => {
          // Log or handle error silently to not crash process
          console.error("Failed to asynchronously write fresh risk score to DB:", err);
        });

        return {
          id: loc.id,
          label: loc.label,
          latitude: loc.latitude,
          longitude: loc.longitude,
          radiusKm: loc.radiusKm,
          createdAt: loc.createdAt,
          currentRisk: freshScores.displayedRisk,
          riskLevel: freshScores.riskLevel,
          events24h: freshScores.eventsInRadius24h,
          maxMag24h: freshScores.largestMag24h,
        };
      } catch (err) {
        // Fallback to default/zeroed values if score calculation fails
        return {
          id: loc.id,
          label: loc.label,
          latitude: loc.latitude,
          longitude: loc.longitude,
          radiusKm: loc.radiusKm,
          createdAt: loc.createdAt,
          currentRisk: 0,
          riskLevel: "Low",
          events24h: 0,
          maxMag24h: null,
        };
      }
    })
  );

  return mappedLocations;
}

/**
 * Get locations by IDs (for SSE registration).
 */
export async function getLocationsByIds(ids) {
  return prisma.userLocation.findMany({
    where: { id: { in: ids } },
    select: { id: true, latitude: true, longitude: true, radiusKm: true },
  });
}

/**
 * Delete a location.
 */
export async function deleteLocation(id) {
  await prisma.userLocation.delete({ where: { id } });
}
