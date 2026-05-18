/**
 * Location service — CRUD for user-monitored locations.
 */

import prisma from "../../../../shared/db/client.js";


export async function createLocation({ label, latitude, longitude, radiusKm = 500, telegramChatId }) {
  const location = await prisma.userLocation.create({
    data: {
      label,
      latitude,
      longitude,
      radiusKm,
      telegramChatId: BigInt(telegramChatId),
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
 * Get all locations for a Telegram chat.
 */
export async function getLocations(telegramChatId) {
  return prisma.userLocation.findMany({
    where: { telegramChatId: BigInt(telegramChatId) },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, label: true, latitude: true, longitude: true,
      radiusKm: true, createdAt: true,
    },
  });
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
