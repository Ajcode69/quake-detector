/**
 * SSE (Server-Sent Events) route — live earthquake stream.
 *
 * Supports two modes:
 *   1. Global:    GET /api/stream              → all events (admin/dashboard)
 *   2. Filtered:  GET /api/stream?locations=1,2,3  → only events near those location IDs
 *
 * Why SSE over WebSocket:
 * - Simpler (HTTP-native, no upgrade)
 * - One-directional (server → client) which is all we need
 * - Auto-reconnects built into EventSource browser API
 */

import { Router } from "express";
import { registerSSEClient, removeSSEClient, sseClients } from "../services/persister.service.js";

const router = Router();

/**
 * GET /api/stream
 * Query params:
 *   locations - comma-separated user_location IDs (optional)
 *               If omitted, client gets ALL events (global view).
 */
router.get("/", async (req, res) => {
  // Set SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Parse location IDs from query
  const locationParam = req.query.locations;
  const locationIds = locationParam
    ? locationParam.split(",").map(Number).filter(Boolean)
    : null;

  // Register this client with their locations
  const clientId = await registerSSEClient(res, locationIds);

  // Send initial connection event
  res.write(
    `data: ${JSON.stringify({
      type: "connected",
      clientId,
      mode: locationIds ? "filtered" : "global",
      locationCount: locationIds?.length ?? 0,
      timestamp: Date.now(),
    })}\n\n`
  );

  req.log.info(
    { clientId, mode: locationIds ? "filtered" : "global", totalClients: sseClients.size },
    "SSE client connected"
  );

  // Heartbeat every 30s
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 30_000);

  // Cleanup on disconnect
  req.on("close", () => {
    clearInterval(heartbeat);
    removeSSEClient(clientId);
    req.log.info({ clientId, totalClients: sseClients.size }, "SSE client disconnected");
  });
});

export default router;
