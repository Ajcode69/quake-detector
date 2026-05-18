/**
 * Location risk routes — per-location risk scores, nearby events, time-series history.
 * Powers the Locations module and Grafana-like time-series charts.
 */

import { Router } from "express";
import prisma from "../../../../shared/db/client.js";

const router = Router();

/**
 * GET /api/locations/:id/risk?historyHours=168
 * Returns current risk score, history time-series, nearby events, and swarm status.
 */
router.get("/:id/risk", async (req, res) => {
  try {
    const locationId = parseInt(req.params.id);
    const historyHours = parseInt(req.query.historyHours || "168"); // 7 days default

    const location = await prisma.userLocation.findUnique({
      where: { id: locationId },
      select: { id: true, label: true, latitude: true, longitude: true, radiusKm: true },
    });

    if (!location) return res.status(404).json({ error: "Location not found" });

    const [currentScore, scoreHistory, nearbyEvents, eventCounts, swarmCheck] = await Promise.all([
      // Latest risk score
      prisma.locationRiskScore.findFirst({
        where: { locationId },
        orderBy: { timestamp: "desc" },
      }),

      // Time-series history (Grafana-like data points)
      prisma.locationRiskScore.findMany({
        where: {
          locationId,
          timestamp: { gte: new Date(Date.now() - historyHours * 3600_000) },
        },
        orderBy: { timestamp: "asc" },
        select: {
          timestamp: true,
          staticScore: true,
          deltaScore: true,
          postEventScore: true,
          displayedRisk: true,
          riskLevel: true,
          eventsInRadius1h: true,
          eventsInRadius24h: true,
          largestMag24h: true,
          aftershockWindowActive: true,
        },
      }),

      // Nearby events with distance
      prisma.$queryRawUnsafe(`
        SELECT
          e.id, e.mag, e.mag_type AS "magType", e.place, e.event_time AS "eventTime",
          e.sig, e.mmi, e.alert, e.tsunami, e.felt, e.depth,
          e.latitude, e.longitude, e.status,
          ST_Distance(e.geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0 AS "distanceKm"
        FROM earthquakes e
        WHERE ST_DWithin(
          e.geog,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          $3 * 1000
        )
        AND e.event_time > NOW() - INTERVAL '30 days'
        ORDER BY e.event_time DESC
        LIMIT 100
      `, location.longitude, location.latitude, location.radiusKm),

      // Event counts by time window
      prisma.$queryRawUnsafe(`
        SELECT
          COUNT(CASE WHEN e.event_time > NOW() - INTERVAL '24 hours' THEN 1 END)::int AS "count24h",
          COUNT(CASE WHEN e.event_time > NOW() - INTERVAL '7 days' THEN 1 END)::int AS "count7d",
          COUNT(CASE WHEN e.event_time > NOW() - INTERVAL '30 days' THEN 1 END)::int AS "count30d",
          COALESCE(MAX(CASE WHEN e.event_time > NOW() - INTERVAL '24 hours' THEN e.mag END), 0)::float AS "maxMag24h",
          COALESCE(MAX(CASE WHEN e.event_time > NOW() - INTERVAL '7 days' THEN e.mag END), 0)::float AS "maxMag7d",
          COALESCE(ROUND(AVG(CASE WHEN e.event_time > NOW() - INTERVAL '7 days' THEN e.depth END)::numeric, 1), 0)::float AS "avgDepth7d",
          COUNT(CASE WHEN ST_Distance(e.geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0 <= 100
                      AND e.event_time > NOW() - INTERVAL '7 days' THEN 1 END)::int AS "within100km",
          COUNT(CASE WHEN ST_Distance(e.geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0 <= 500
                      AND e.event_time > NOW() - INTERVAL '7 days' THEN 1 END)::int AS "within500km"
        FROM earthquakes e
        WHERE ST_DWithin(
          e.geog,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          $3 * 1000
        )
      `, location.longitude, location.latitude, location.radiusKm),

      // Swarm detection near this location
      prisma.$queryRawUnsafe(`
        SELECT
          COUNT(*)::int AS "count",
          ROUND(AVG(mag)::numeric, 1)::float AS "avgMag",
          MAX(mag)::float AS "maxMag",
          MIN(event_time) AS "firstEvent",
          MAX(event_time) AS "lastEvent"
        FROM earthquakes
        WHERE ST_DWithin(
          geog,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          50000
        )
        AND event_time > NOW() - INTERVAL '6 hours'
        AND mag >= 1.5
      `, location.longitude, location.latitude),
    ]);

    const swarmData = swarmCheck[0];
    const swarmActive = swarmData && swarmData.count >= 5;

    // Get active alert thresholds for this location
    const alertRules = await prisma.userAlertRule.findMany({
      where: { locationId },
      select: {
        id: true, minMag: true, alertOnTsunami: true, alertOnPager: true,
        quietHoursStart: true, quietHoursEnd: true, enabled: true,
      },
    });

    res.json({
      location,
      current: currentScore || null,
      timeSeries: {
        points: scoreHistory,
        // Grafana-compatible format for charting
        series: [
          {
            name: "Displayed Risk",
            field: "displayedRisk",
            color: "#ef4444",
            data: scoreHistory.map((s) => ({ t: s.timestamp, v: s.displayedRisk })),
          },
          {
            name: "Static Score",
            field: "staticScore",
            color: "#f59e0b",
            data: scoreHistory.map((s) => ({ t: s.timestamp, v: s.staticScore })),
          },
          {
            name: "Delta Score",
            field: "deltaScore",
            color: "#3b82f6",
            data: scoreHistory.map((s) => ({ t: s.timestamp, v: s.deltaScore })),
          },
          {
            name: "Post-Event Score",
            field: "postEventScore",
            color: "#8b5cf6",
            data: scoreHistory.map((s) => ({ t: s.timestamp, v: s.postEventScore })),
          },
          {
            name: "Events in Radius (1h)",
            field: "eventsInRadius1h",
            color: "#06b6d4",
            data: scoreHistory.map((s) => ({ t: s.timestamp, v: s.eventsInRadius1h })),
          },
          {
            name: "Events in Radius (24h)",
            field: "eventsInRadius24h",
            color: "#10b981",
            data: scoreHistory.map((s) => ({ t: s.timestamp, v: s.eventsInRadius24h })),
          },
        ],
      },
      nearbyEvents,
      eventCounts: eventCounts[0] || {},
      swarm: swarmActive
        ? {
            active: true,
            count: swarmData.count,
            avgMag: swarmData.avgMag,
            maxMag: swarmData.maxMag,
            firstEvent: swarmData.firstEvent,
            lastEvent: swarmData.lastEvent,
          }
        : { active: false },
      alertThresholds: alertRules,
    });
  } catch (err) {
    req.log.error({ err }, "failed to fetch location risk");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
