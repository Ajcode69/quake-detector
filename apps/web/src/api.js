const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

/**
 * Fetch recent earthquake events.
 * @param {{ limit?: number, minMag?: number, since?: string }} params
 */
export async function fetchEvents({ limit = 50, minMag, since } = {}) {
  const url = new URL(`${API_BASE}/api/events`);
  url.searchParams.set("limit", limit);
  if (minMag) url.searchParams.set("minMag", minMag);
  if (since) url.searchParams.set("since", since);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/**
 * Fetch a single event with revision history.
 * @param {string} id
 */
export async function fetchEvent(id) {
  const res = await fetch(`${API_BASE}/api/events/${id}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/**
 * Fetch system health.
 */
export async function fetchHealth() {
  const res = await fetch(`${API_BASE}/api/health`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/**
 * Create an SSE connection for live events.
 * @param {(event: object) => void} onEvent
 * @returns {{ close: () => void }}
 */
export function connectSSE(onEvent) {
  const source = new EventSource(`${API_BASE}/api/stream`);

  source.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type !== "connected") {
        onEvent(data);
      }
    } catch {
      // ignore parse errors (heartbeats, etc.)
    }
  };

  source.onerror = () => {
    // EventSource auto-reconnects — browser handles this
  };

  return {
    close: () => source.close(),
    source,
  };
}
