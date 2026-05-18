/**
 * Risk scoring service — computes 3-tier risk scores per location.
 *
 * Score 1: Static (Current Location Risk) — point-in-time based on strongest nearby event
 * Score 2: Delta (Trend Score) — detects escalating patterns (swarms, acceleration)
 * Score 3: Post-Event — aftershock tracking after M4.0+ mainshock
 *
 * Runs every 5 minutes via cron, broadcasts results over SSE,
 * and produces alerts to earthquake.alerts Kafka topic when thresholds are crossed.
 */

import prisma from "../../../../shared/db/client.js";
import { createLogger } from "../../../../shared/logger.js";
import { TOPICS } from "../../../../shared/kafka/topics.js";

const log = createLogger("service:risk");

// ── Alert thresholds ────────────────────────────────────────
const STATIC_ALERT_THRESHOLD = 50;
const DELTA_ALERT_THRESHOLD = 60;
const POST_EVENT_ALERT_THRESHOLD = 70;
const POST_EVENT_MAG_TRIGGER = 4.0;

// ── Aftershock decay table (hours → decay factor) ───────────
const AFTERSHOCK_DECAY = [
  { hours: 0, decay: 1.0 },
  { hours: 6, decay: 0.7 },
  { hours: 24, decay: 0.5 },
  { hours: 72, decay: 0.3 },
  { hours: 168, decay: 0.1 }, // 7 days
];

/**
 * Main orchestrator — compute scores for ALL locations, store, broadcast, alert.
 * @param {import('kafkajs').Producer} producer - Kafka producer for alerts
 * @param {(payload: object) => void} broadcastFn - SSE broadcast function
 */
export async function computeAndBroadcast(producer, broadcastFn) {
  const locations = await prisma.userLocation.findMany({
    select: {
      id: true, label: true, latitude: true, longitude: true,
      radiusKm: true, telegramChatId: true,
    },
  });

  if (locations.length === 0) {
    log.debug("no locations to score");
    return;
  }

  const results = [];

  for (const loc of locations) {
    try {
      const scores = await computeAllScoresForLocation(loc);
      results.push(scores);

      // Persist score row
      await prisma.locationRiskScore.create({ data: {
        locationId: loc.id,
        staticScore: scores.staticScore,
        deltaScore: scores.deltaScore,
        postEventScore: scores.postEventScore,
        displayedRisk: scores.displayedRisk,
        riskLevel: scores.riskLevel,
        triggerEventId: scores.triggerEventId,
        aftershockWindowActive: scores.aftershockWindowActive,
        expectedAftershockMag: scores.expectedAftershockMag,
        eventsInRadius1h: scores.eventsInRadius1h,
        eventsInRadius24h: scores.eventsInRadius24h,
        largestMag24h: scores.largestMag24h,
      }});

      // Check alert thresholds → produce to Kafka alerts topic
      await checkAndAlert(loc, scores, producer);
    } catch (err) {
      log.error({ err, locationId: loc.id }, "failed to compute scores for location");
    }
  }

  // Broadcast all scores to SSE clients
  if (broadcastFn && results.length > 0) {
    broadcastFn({
      type: "risk_update",
      scores: results,
      timestamp: Date.now(),
    });
  }

  log.info({ locationCount: results.length }, "risk scores computed and broadcast");
}

/**
 * Compute all 3 scores for a single location.
 */
async function computeAllScoresForLocation(loc) {
  const { id, latitude, longitude, radiusKm, label } = loc;

  // Fetch events within radius from last 7 days (for post-event + delta calculations)
  const events = await getEventsInRadius(longitude, latitude, radiusKm, 168); // 7 days

  // Event counts for metadata
  const now = Date.now();
  const events1h = events.filter((e) => now - new Date(e.event_time).getTime() < 3600_000);
  const events24h = events.filter((e) => now - new Date(e.event_time).getTime() < 86400_000);
  const largestMag24h = events24h.length > 0
    ? Math.max(...events24h.map((e) => e.mag || 0))
    : null;

  // Score 1: Static
  const staticResult = computeStaticScore(events, longitude, latitude);

  // Score 2: Delta
  const deltaResult = computeDeltaScore(events, longitude, latitude);

  // Score 3: Post-Event
  const postResult = computePostEventScore(events);

  // Combined displayed risk
  const displayedRisk = Math.min(100, Math.max(
    staticResult.score,
    deltaResult.score * 0.8,
    postResult.score * 0.9
  ));

  const riskLevel = getRiskLevel(displayedRisk);

  return {
    locationId: id,
    locationLabel: label,
    latitude,
    longitude,
    staticScore: Math.round(staticResult.score * 10) / 10,
    deltaScore: Math.round(deltaResult.score * 10) / 10,
    postEventScore: Math.round(postResult.score * 10) / 10,
    displayedRisk: Math.round(displayedRisk * 10) / 10,
    riskLevel,
    triggerEventId: staticResult.triggerEventId,
    aftershockWindowActive: postResult.aftershockActive,
    expectedAftershockMag: postResult.expectedAftershockMag,
    eventsInRadius1h: events1h.length,
    eventsInRadius24h: events24h.length,
    largestMag24h,
    // Extra detail for frontend
    staticDetail: staticResult.detail,
    deltaDetail: deltaResult.detail,
    postEventDetail: postResult.detail,
    actionGuidance: getActionGuidance(displayedRisk, staticResult.triggerEvent),
  };
}

// ── Score 1: Static (Current Location Risk) ─────────────────

function computeStaticScore(events, locLon, locLat) {
  if (events.length === 0) {
    return { score: 0, triggerEventId: null, triggerEvent: null, detail: "No events nearby" };
  }

  const now = Date.now();
  let maxScore = 0;
  let triggerEvent = null;

  for (const event of events) {
    const mag = event.mag || 0;
    const depth = event.depth || 30;
    const distKm = event.distance_km || 0;
    const hoursSince = (now - new Date(event.event_time).getTime()) / 3600_000;

    // Base = mag² × 10  (non-linear: M5 = 250, M4 = 160, M3 = 90)
    const base = Math.pow(mag, 2) * 10;

    // Proximity: halves every 100km
    const proximity = 1 / (distKm / 100 + 1);

    // Recency: decays to ~50% in 12 hours
    const recency = Math.exp(-hoursSince / 12);

    // Depth factor
    const depthFactor = depth < 20 ? 1.5 : depth < 70 ? 1.0 : 0.6;

    let raw = base * proximity * recency * depthFactor;

    // Bonuses
    if (event.tsunami === 1) raw += 30;
    if (event.alert === "red") raw += 25;
    else if (event.alert === "orange") raw += 15;
    else if (event.alert === "yellow") raw += 5;

    if (event.felt > 500) raw += 20;
    else if (event.felt > 100) raw += 10;

    if (event.mmi > 6) raw += 10;

    // Quality adjustments
    if (event.status === "reviewed") raw *= 1.1;
    if (event.nst != null && event.nst < 5) raw *= 0.8;

    if (raw > maxScore) {
      maxScore = raw;
      triggerEvent = event;
    }
  }

  // Normalize to 0-100 (cap at 100)
  // M6.5 shallow at 10km = ~6.5²×10 × (1/(10/100+1)) × 1 × 1.5 ≈ 422 × 0.91 × 1.5 ≈ 576
  // Normalization divisor: ~6 to map typical max to 100
  const normalized = Math.min(100, maxScore / 6);

  return {
    score: normalized,
    triggerEventId: triggerEvent?.id || null,
    triggerEvent,
    detail: triggerEvent
      ? `M${triggerEvent.mag} at ${Math.round(triggerEvent.distance_km)}km, ${triggerEvent.place}`
      : "No significant events",
  };
}

// ── Score 2: Delta (Trend Score) ────────────────────────────

function computeDeltaScore(events, locLon, locLat) {
  const now = Date.now();
  const recentEvents = events
    .filter((e) => now - new Date(e.event_time).getTime() < 86400_000) // last 24h
    .sort((a, b) => new Date(a.event_time) - new Date(b.event_time));

  if (recentEvents.length < 3) {
    return { score: 0, detail: { magTrend: 0, freqAccel: 0, cohesion: 0, compression: 0, raw: "Insufficient data" } };
  }

  // Component A — Magnitude Trend (last 10 events)
  const last10 = recentEvents.slice(-10);
  const magTrend = computeMagTrend(last10);

  // Component B — Frequency Acceleration (3h vs 24h)
  const freqAccel = computeFreqAcceleration(events);

  // Component C — Swarm Cohesion (last 5 vs last 20)
  const cohesion = computeSwarmCohesion(recentEvents);

  // Component D — Inter-event Time Shrinking
  const compression = computeTimeCompression(recentEvents);

  const total = magTrend + freqAccel + cohesion + compression;
  const normalized = Math.min(100, total);

  return {
    score: normalized,
    detail: {
      magTrend: Math.round(magTrend * 10) / 10,
      freqAccel: Math.round(freqAccel * 10) / 10,
      cohesion: Math.round(cohesion * 10) / 10,
      compression: Math.round(compression * 10) / 10,
    },
  };
}

function computeMagTrend(events) {
  if (events.length < 3) return 0;
  const mags = events.map((e) => e.mag || 0);
  const n = mags.length;
  const xMean = (n - 1) / 2;
  const yMean = mags.reduce((s, m) => s + m, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (mags[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return Math.max(0, slope * 20); // rising slope adds to score
}

function computeFreqAcceleration(events) {
  const now = Date.now();
  const events3h = events.filter((e) => now - new Date(e.event_time).getTime() < 10800_000);
  const events24h = events.filter((e) => now - new Date(e.event_time).getTime() < 86400_000);

  const rate3h = events3h.length / 3; // per hour
  const rate24h = events24h.length / 24; // per hour

  if (rate24h === 0) return 0;

  const acceleration = rate3h / rate24h;
  return Math.min(40, Math.log(acceleration + 1) * 20);
}

function computeSwarmCohesion(events) {
  if (events.length < 5) return 0;

  const last5 = events.slice(-5);
  const last20 = events.slice(-20);

  const radius5 = computeBoundingRadius(last5);
  const radius20 = computeBoundingRadius(last20);

  if (radius20 === 0) return 0;
  return Math.max(0, (radius20 - radius5) / radius20 * 20);
}

function computeBoundingRadius(events) {
  if (events.length < 2) return 0;
  const lats = events.map((e) => e.latitude).filter(Boolean);
  const lons = events.map((e) => e.longitude).filter(Boolean);
  if (lats.length < 2) return 0;

  const centerLat = lats.reduce((s, v) => s + v, 0) / lats.length;
  const centerLon = lons.reduce((s, v) => s + v, 0) / lons.length;

  let maxDist = 0;
  for (let i = 0; i < lats.length; i++) {
    const d = haversineKm(centerLat, centerLon, lats[i], lons[i]);
    if (d > maxDist) maxDist = d;
  }
  return maxDist;
}

function computeTimeCompression(events) {
  if (events.length < 5) return 0;

  const last5 = events.slice(-5);
  const last10 = events.slice(-10);

  const avgGap5 = computeAvgGap(last5);
  const avgGap10 = computeAvgGap(last10);

  if (avgGap5 === 0 || avgGap10 === 0) return 0;

  const compression = avgGap10 / avgGap5; // >1 means accelerating
  return Math.min(20, (compression - 1) * 15);
}

function computeAvgGap(events) {
  if (events.length < 2) return 0;
  let totalGap = 0;
  for (let i = 1; i < events.length; i++) {
    totalGap += new Date(events[i].event_time) - new Date(events[i - 1].event_time);
  }
  return totalGap / (events.length - 1);
}

// ── Score 3: Post-Event State ───────────────────────────────

function computePostEventScore(events) {
  const now = Date.now();

  // Find the strongest event M4.0+ in last 7 days within radius
  const significantEvents = events
    .filter((e) => (e.mag || 0) >= POST_EVENT_MAG_TRIGGER)
    .sort((a, b) => (b.mag || 0) - (a.mag || 0));

  if (significantEvents.length === 0) {
    return {
      score: 0,
      aftershockActive: false,
      expectedAftershockMag: null,
      detail: "No significant mainshock",
    };
  }

  const mainshock = significantEvents[0];
  const hoursSince = (now - new Date(mainshock.event_time).getTime()) / 3600_000;

  // Aftershock decay (Omori-Utsu approximation)
  const decay = interpolateDecay(hoursSince);

  // Båth's law: expected aftershock mag ≈ mainshock - 1.2
  const expectedMag = Math.round((mainshock.mag - 1.2) * 10) / 10;

  // Aftershock risk base
  const aftershockRisk = Math.pow(mainshock.mag, 2) * decay;

  // Active aftershocks in last 6h
  const aftershocks6h = events.filter((e) => {
    if (e.id === mainshock.id) return false;
    const t = new Date(e.event_time).getTime();
    return t > mainshock.event_time && now - t < 21600_000;
  });

  // Check for unusually large aftershock
  const largeAftershock = aftershocks6h.some((e) => (e.mag || 0) > mainshock.mag - 0.5);

  let postEventRaw = aftershockRisk * 100 / 42.25 // normalize (M6.5² = 42.25)
    + (aftershocks6h.length * 3)
    + (largeAftershock ? 20 : 0);

  const score = Math.min(100, postEventRaw);

  return {
    score,
    aftershockActive: hoursSince < 168 && mainshock.mag >= POST_EVENT_MAG_TRIGGER,
    expectedAftershockMag: expectedMag > 0 ? expectedMag : null,
    detail: {
      mainshockId: mainshock.id,
      mainshockMag: mainshock.mag,
      hoursSince: Math.round(hoursSince),
      decay: Math.round(decay * 100) / 100,
      aftershocks6h: aftershocks6h.length,
      largeAftershock,
      expectedMag: expectedMag > 0 ? expectedMag : null,
    },
  };
}

function interpolateDecay(hours) {
  if (hours <= 0) return 1.0;
  for (let i = 1; i < AFTERSHOCK_DECAY.length; i++) {
    const prev = AFTERSHOCK_DECAY[i - 1];
    const curr = AFTERSHOCK_DECAY[i];
    if (hours <= curr.hours) {
      const t = (hours - prev.hours) / (curr.hours - prev.hours);
      return prev.decay + t * (curr.decay - prev.decay);
    }
  }
  return 0.05; // beyond 7 days
}

// ── Action guidance ─────────────────────────────────────────

function getActionGuidance(displayedRisk, triggerEvent) {
  const mag = triggerEvent?.mag || 0;
  const depth = triggerEvent?.depth || 50;
  const felt = triggerEvent?.felt || 0;
  const tsunami = triggerEvent?.tsunami || 0;
  const alert = triggerEvent?.alert;

  if (displayedRisk >= 80 || mag > 6.5 || alert === "red" || alert === "orange" || tsunami === 1) {
    return {
      level: "critical",
      message: "Critical event. Follow local emergency authority instructions." +
        (tsunami === 1 ? " Tsunami: move inland immediately if on coast." : "") +
        " Do not re-enter damaged structures. Aftershock monitoring active.",
    };
  }

  if (displayedRisk >= 60 || (mag >= 5.0 && depth < 50)) {
    return {
      level: "high",
      message: `Significant event. If in affected area: evacuate if structure damaged.` +
        ` Expect aftershocks up to M${Math.round((mag - 1.2) * 10) / 10}.` +
        ` Avoid coastlines if near water. Check on vulnerable individuals nearby.`,
    };
  }

  if (displayedRisk >= 30 || (mag >= 4.0 && felt > 0)) {
    return {
      level: "moderate",
      message: `Check for structural damage in your area. Avoid weakened buildings.` +
        ` Aftershocks up to M${Math.round((mag - 1.2) * 10) / 10} possible for 48h. Stay alert.`,
    };
  }

  return {
    level: "low",
    message: "Monitoring only. No action needed." +
      (mag >= POST_EVENT_MAG_TRIGGER ? " Aftershock watch active for 24h." : ""),
  };
}

// ── Alert production ────────────────────────────────────────

async function checkAndAlert(loc, scores, producer) {
  const alerts = [];

  if (scores.staticScore >= STATIC_ALERT_THRESHOLD) {
    alerts.push({
      type: "risk_static",
      reason: `📊 Static risk score ${scores.staticScore} (${scores.riskLevel}) for "${loc.label}" — ${scores.staticDetail}`,
    });
  }

  if (scores.deltaScore >= DELTA_ALERT_THRESHOLD) {
    alerts.push({
      type: "risk_delta",
      reason: `📈 Trend score ${scores.deltaScore} for "${loc.label}" — escalating seismic pattern detected` +
        ` (mag trend: ${scores.deltaDetail.magTrend}, freq: ${scores.deltaDetail.freqAccel}, cohesion: ${scores.deltaDetail.cohesion})`,
    });
  }

  if (scores.postEventScore >= POST_EVENT_ALERT_THRESHOLD) {
    const pd = scores.postEventDetail;
    alerts.push({
      type: "risk_postevent",
      reason: `⚡ Post-event score ${scores.postEventScore} for "${loc.label}"` +
        ` — M${pd.mainshockMag} mainshock ${pd.hoursSince}h ago, ${pd.aftershocks6h} aftershocks in 6h` +
        (pd.expectedMag ? `, expect up to M${pd.expectedMag}` : ""),
    });
  }

  if (alerts.length === 0) return;

  const severity = scores.displayedRisk >= 75 ? "critical"
    : scores.displayedRisk >= 50 ? "warning"
    : "info";

  const alertPayload = {
    eventId: scores.triggerEventId || `risk-${loc.id}-${Date.now()}`,
    chatId: String(loc.telegramChatId),
    rules: alerts,
    severity,
    isRevision: false,
    event: {
      mag: scores.largestMag24h,
      place: loc.label,
      sig: null,
      tsunami: 0,
      depth: null,
      alert: null,
    },
    riskScores: {
      static: scores.staticScore,
      delta: scores.deltaScore,
      postEvent: scores.postEventScore,
      displayed: scores.displayedRisk,
      level: scores.riskLevel,
    },
    actionGuidance: scores.actionGuidance,
    timestamp: Date.now(),
  };

  await producer.send({
    topic: TOPICS.ALERTS,
    messages: [{ key: String(loc.telegramChatId), value: JSON.stringify(alertPayload) }],
  });

  log.info(
    { locationId: loc.id, rules: alerts.map((r) => r.type), severity, displayedRisk: scores.displayedRisk },
    "risk alert produced"
  );
}

// ── Spatial query ───────────────────────────────────────────

async function getEventsInRadius(lon, lat, radiusKm, hoursBack) {
  try {
    return await prisma.$queryRawUnsafe(`
      SELECT
        e.id, e.mag, e.depth, e.latitude, e.longitude, e.place,
        e.event_time, e.sig, e.felt, e.cdi, e.mmi, e.alert, e.tsunami,
        e.status, e.nst,
        ST_Distance(e.geog, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000.0 AS distance_km
      FROM earthquakes e
      WHERE ST_DWithin(
          e.geog,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          $3 * 1000
        )
        AND e.event_time > NOW() - INTERVAL '${hoursBack} hours'
      ORDER BY e.event_time DESC
    `, lon, lat, radiusKm);
  } catch (err) {
    log.error({ err, lon, lat, radiusKm }, "failed to query events in radius");
    return [];
  }
}

// ── Helpers ─────────────────────────────────────────────────

function getRiskLevel(score) {
  if (score >= 75) return "Critical";
  if (score >= 50) return "High";
  if (score >= 25) return "Moderate";
  return "Low";
}

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
