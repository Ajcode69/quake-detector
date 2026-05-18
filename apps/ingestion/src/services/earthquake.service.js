/**
 * Earthquake service for the ingestion worker.
 * Handles upsert with revision detection.
 */

import prisma from "../../../../shared/db/client.js";
import { createLogger } from "../../../../shared/logger.js";
import { Prisma } from "@prisma/client";
import { calculateAllScores } from "../utils/scoring.js";

const log = createLogger("service:earthquake");

// Fields we track for revisions (safety-critical)
const WATCH_FIELDS = ["mag", "alert", "mmi", "sig", "tsunami"];

/**
 * Upsert a USGS GeoJSON feature into the database.
 * Detects revisions on safety-critical fields.
 *
 * @param {object} feature - raw USGS GeoJSON feature
 * @returns {{ isNew: boolean, revisions: Array, event: object }}
 */
export async function upsertEarthquake(feature) {
  const p = feature.properties;
  const [lon, lat, depth] = feature.geometry.coordinates;

  const { confidenceScore, impactScore, eventClass } = calculateAllScores(p, depth);

  const existing = await prisma.earthquake.findUnique({
    where: { id: feature.id },
  });

  if (!existing) {
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

    log.info({ id: feature.id, mag: p.mag, place: p.place }, "new event ingested");

    return {
      isNew: true,
      revisions: [],
      event: { id: feature.id, ...p, longitude: lon, latitude: lat, depth, confidenceScore, impactScore, eventClass },
    };
  }

  // ── Existing event: check for revisions ───────────────────
  const revisions = [];
  for (const field of WATCH_FIELDS) {
    const oldVal = existing[field];
    const newVal = p[field];
    if (newVal != null && String(oldVal) !== String(newVal)) {
      revisions.push({ field, old: oldVal, new: newVal });
    }
  }

  const COMPUTED_WATCH = ["impactScore", "eventClass"];
  const computedNew = { impactScore, eventClass };
  for (const field of COMPUTED_WATCH) {
    const oldVal = existing[field];
    const newVal = computedNew[field];
    if (newVal != null && String(oldVal) !== String(newVal)) {
      revisions.push({ field, old: oldVal, new: newVal });
    }
  }

  // Always update with latest data
  await prisma.earthquake.update({
    where: { id: feature.id },
    data: {
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
    },
  });

  // Update geog
  await prisma.$executeRaw`
    UPDATE earthquakes
    SET geog = ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography
    WHERE id = ${feature.id}
  `;

  // Record revisions
  if (revisions.length > 0) {
    await prisma.eventRevision.createMany({
      data: revisions.map((r) => ({
        eventId: feature.id,
        fieldName: r.field,
        oldValue: String(r.old),
        newValue: String(r.new),
      })),
    });

    log.info(
      { id: feature.id, changes: revisions.map((r) => `${r.field}: ${r.old}→${r.new}`) },
      "event revised"
    );
  }

  return {
    isNew: false,
    revisions,
    event: { id: feature.id, ...p, longitude: lon, latitude: lat, depth, confidenceScore, impactScore, eventClass },
  };
}
