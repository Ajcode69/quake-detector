const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";

/**
 * Fetch recent earthquake events.
 * Supports optional location filtering.
 */
export async function fetchEvents({ limit = 50, minMag, since, locationIds } = {}) {
  const url = new URL(`${API_BASE}/api/events`);
  url.searchParams.set("limit", limit);
  if (minMag) url.searchParams.set("minMag", minMag);
  if (since) url.searchParams.set("since", since);
  if (locationIds?.length) url.searchParams.set("locations", locationIds.join(","));

  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/**
 * Fetch a single event with revision history.
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

// ── Geocoding ───────────────────────────────────────────────

/**
 * Search for locations via Nominatim (proxied through our API).
 */
export async function searchLocations(query) {
  if (!query || query.trim().length < 2) return [];
  const res = await fetch(`${API_BASE}/api/geocode?q=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  const { data } = await res.json();
  return data;
}

// ── User locations ──────────────────────────────────────────

/**
 * Get saved locations for a chat.
 */
export async function fetchUserLocations(chatId) {
  const res = await fetch(`${API_BASE}/api/locations?chatId=${chatId}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const { data } = await res.json();
  return data;
}

/**
 * Save a new monitored location.
 */
export async function saveLocation({ label, latitude, longitude, radiusKm, telegramChatId }) {
  const res = await fetch(`${API_BASE}/api/locations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, latitude, longitude, radiusKm, telegramChatId }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const { data } = await res.json();
  return data;
}

/**
 * Delete a monitored location.
 */
export async function deleteLocationApi(id) {
  const res = await fetch(`${API_BASE}/api/locations/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

// ── SSE ─────────────────────────────────────────────────────

/**
 * SSE connection for live events.
 * @param {(event: object) => void} onEvent
 * @param {number[]} locationIds - filter by saved locations
 */
export function connectSSE(onEvent, locationIds) {
  let url = `${API_BASE}/api/stream`;
  if (locationIds?.length) {
    url += `?locations=${locationIds.join(",")}`;
  }

  const source = new EventSource(url);

  source.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type !== "connected") onEvent(data);
    } catch {
      // heartbeats etc
    }
  };

  source.onerror = () => {};

  return { close: () => source.close(), source };
}
