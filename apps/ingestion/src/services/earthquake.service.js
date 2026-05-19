
import prisma from "../../../../shared/db/client.js";
import { createLogger } from "../../../../shared/logger.js";
import { Prisma } from "@prisma/client";
import { calculateAllScores } from "../utils/scoring.js";

const log = createLogger("service:earthquake");


const WATCH_FIELDS = ["mag", "alert", "mmi", "sig", "tsunami"];

/**
 * Upsert a USGS GeoJSON feature into the database.
 * Detects revisions on safety-critical fields.
 *
 * @param {object} feature - raw USGS GeoJSON feature
 * @returns {{ isNew: boolean, revisions: Array, event: object }}
 */
export async function upsertEarthquake(feature, options = { notify: true }) {
  const p = feature.properties;
  const [lon, lat, depth] = feature.geometry.coordinates;

  const { confidenceScore, impactScore, eventClass } = calculateAllScores(p, depth);

  const allIds = p.ids ? p.ids.split(',').filter(Boolean) : [];
  if (!allIds.includes(feature.id)) allIds.push(feature.id);

  const existingEvents = await prisma.earthquake.findMany({
    where: { id: { in: allIds } },
  });

  if (existingEvents.length === 0) {
    // ── New event: create + set geog via raw SQL ────────────
    await prisma.earthquake.create({
      data: {
        id: feature.id,
        mag: p.mag,
        magType: p.magType,
        place: p.place,
        eventTime: new Date(p.time),
        updatedAt: p.updated ? new Date(p.updated) : null,
        sig: p.sig,
        mmi: p.mmi,
        cdi: p.cdi,
        alert: p.alert,
        tsunami: p.tsunami ?? 0,
        felt: p.felt,
        depth,
        latitude: lat,
        longitude: lon,
        status: p.status,
        confidenceScore,
        impactScore,
        eventClass,
        net: p.net,
        code: p.code,
        ids: p.ids,
        sources: p.sources,
        types: p.types,
        nst: p.nst,
        dmin: p.dmin,
        rms: p.rms,
        gap: p.gap,
        eventType: p.type || "earthquake",
        url: p.url,
        detailUrl: p.detail,
      },
    });

    // Set PostGIS geog column (Prisma can't handle Unsupported on write)
    await prisma.$executeRaw`
      UPDATE earthquakes
      SET geog = ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography
      WHERE id = ${feature.id}
    `;

    // NOTIFY for new event
    if (options.notify) {
      await prisma.$executeRawUnsafe(`NOTIFY earthquake_raw, '{"id": "${feature.id}"}'`);
    }

    log.info({ id: feature.id, mag: p.mag, place: p.place }, "new event ingested");

    return {
      isNew: true,
      revisions: [],
      event: { id: feature.id, ...p, longitude: lon, latitude: lat, depth, confidenceScore, impactScore, eventClass },
    };
  }

  // ── Existing event(s): Merge & check for revisions ───────────────────

  // Find the best existing event among duplicates (highest confidence score)
  const bestExisting = existingEvents.reduce((prev, current) => {
    return (prev.confidenceScore || 0) > (current.confidenceScore || 0) ? prev : current;
  });

  // Delete inferior duplicates to merge them into a single event
  const duplicateIds = existingEvents.map(e => e.id).filter(id => id !== bestExisting.id);
  if (duplicateIds.length > 0) {
    await prisma.earthquake.deleteMany({
      where: { id: { in: duplicateIds } }
    });
    log.info({ deleted: duplicateIds, kept: bestExisting.id }, "merged duplicate events");
  }

  // Determine if incoming data has higher/equal quality
  const incomingWins = confidenceScore >= (bestExisting.confidenceScore || 0);

  let dataToUpdate;
  let updateLon = bestExisting.longitude;
  let updateLat = bestExisting.latitude;
  const revisions = [];

  if (incomingWins) {
    // Generate revisions against the best existing event
    for (const field of WATCH_FIELDS) {
      const oldVal = bestExisting[field];
      const newVal = p[field];
      if (newVal != null && String(oldVal) !== String(newVal)) {
        revisions.push({ field, old: oldVal, new: newVal });
      }
    }

    const COMPUTED_WATCH = ["impactScore", "eventClass"];
    const computedNew = { impactScore, eventClass };
    for (const field of COMPUTED_WATCH) {
      const oldVal = bestExisting[field];
      const newVal = computedNew[field];
      if (newVal != null && String(oldVal) !== String(newVal)) {
        revisions.push({ field, old: oldVal, new: newVal });
      }
    }

    dataToUpdate = {
      mag: p.mag,
      magType: p.magType,
      place: p.place,
      updatedAt: p.updated ? new Date(p.updated) : null,
      sig: p.sig,
      mmi: p.mmi,
      cdi: p.cdi,
      alert: p.alert,
      tsunami: p.tsunami ?? 0,
      felt: p.felt,
      depth,
      latitude: lat,
      longitude: lon,
      status: p.status,
      confidenceScore,
      impactScore,
      eventClass,
      nst: p.nst,
      dmin: p.dmin,
      rms: p.rms,
      gap: p.gap,
      net: p.net,
      code: p.code,
      ids: p.ids,
      sources: p.sources,
      types: p.types,
      eventType: p.type || "earthquake",
      url: p.url,
      detailUrl: p.detail,
    };
    updateLon = lon;
    updateLat = lat;
  } else {
    // Existing wins: we keep its data, but update ids and timestamp to reflect merge
    dataToUpdate = {
      ids: p.ids,
      updatedAt: p.updated ? new Date(p.updated) : bestExisting.updatedAt,
    };
  }

  // Always update bestExisting
  await prisma.earthquake.update({
    where: { id: bestExisting.id },
    data: dataToUpdate,
  });

  // Update geog if location changed
  if (incomingWins) {
    await prisma.$executeRaw`
      UPDATE earthquakes
      SET geog = ST_SetSRID(ST_MakePoint(${updateLon}, ${updateLat}), 4326)::geography
      WHERE id = ${bestExisting.id}
    `;
  }

  // Record revisions
  if (revisions.length > 0) {
    await prisma.eventRevision.createMany({
      data: revisions.map((r) => ({
        eventId: bestExisting.id,
        fieldName: r.field,
        oldValue: String(r.old),
        newValue: String(r.new),
      })),
    });

    log.info(
      { id: bestExisting.id, changes: revisions.map((r) => `${r.field}: ${r.old}→${r.new}`) },
      "event revised"
    );
  }

  return {
    isNew: false,
    revisions,
    event: incomingWins
      ? { id: bestExisting.id, ...p, longitude: lon, latitude: lat, depth, confidenceScore, impactScore, eventClass }
      : { ...bestExisting, ids: p.ids, updatedAt: dataToUpdate.updatedAt },
  };
}
