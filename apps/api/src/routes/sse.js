/**
 * SSE (Server-Sent Events) route — live earthquake stream.
 *
 * Clients connect to GET /api/stream and receive real-time events
 * as they are consumed from Kafka by the persister consumer.
 *
 * Why SSE over WebSocket:
 * - Simpler (HTTP-native, no upgrade handshake)
 * - One-directional (server → client) which is all we need
 * - Auto-reconnects built into the EventSource browser API
 * - Scales to polling/SSE hybrid at 10K connections without extra infra
 */

import { Router } from "express";
import { sseClients } from "../consumers/persister.js";

const router = Router();

/**
 * GET /api/stream
 * SSE endpoint — clients receive earthquake events as they arrive.
 */
router.get("/", (req, res) => {
  // Set SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // disable nginx buffering
  });

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: "connected", timestamp: Date.now() })}\n\n`);

  // Register this client
  sseClients.add(res);

  req.log.info({ totalClients: sseClients.size }, "SSE client connected");

  // Heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 30_000);

  // Cleanup on disconnect
  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    req.log.info({ totalClients: sseClients.size }, "SSE client disconnected");
  });
});

export default router;
