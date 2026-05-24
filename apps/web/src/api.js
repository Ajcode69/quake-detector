const API_BASE = "https://sesimicops-f6ezfce3a0egegbq.canadacentral-01.azurewebsites.net";

export const getUserId = () => localStorage.getItem("quake_user_id");

// ── Helper ──────────────────────────────────────────────────
async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const userId = getUserId();
  if (userId) headers.set("x-user-id", userId);

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
}

// ── Events ──────────────────────────────────────────────────
export async function fetchEvents(params = {}) {
  const url = new URL(`${API_BASE}/api/events`);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") url.searchParams.set(k, v);
  });
  return api(`/api/events?${url.searchParams.toString().replace(API_BASE, "")}`);
}

export async function fetchMapEvents(params = {}) {
  const url = new URL(`${API_BASE}/api/events/map`);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== "") url.searchParams.set(k, v);
  });
  return api(`/api/events/map?${url.searchParams.toString().replace(API_BASE, "")}`);
}

export function fetchEvent(id) {
  return api(`/api/events/${id}`);
}

// ── Stats ───────────────────────────────────────────────────
export function fetchStats(timeWindow = "24h") {
  return api(`/api/stats?timeWindow=${timeWindow}`);
}

// ── Health ──────────────────────────────────────────────────
export function fetchHealth() {
  return api("/api/health");
}

export function fetchHealthDetailed() {
  return api("/api/health/detailed");
}

// ── Alerts ──────────────────────────────────────────────────
export function fetchAlerts(params = {}) {
  const url = new URL(`${API_BASE}/api/alerts`);
  Object.entries(params).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, String(v));
  });
  const qs = url.searchParams.toString();
  return api(`/api/alerts?${qs}`);
}

export function fetchAlertRules(chatId) {
  return api(`/api/alerts/rules?chatId=${chatId}`);
}

export function updateAlertRule(id, data) {
  return fetch(`${API_BASE}/api/alerts/rules/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-user-id": getUserId() || "1" },
    body: JSON.stringify(data),
  }).then((r) => r.json());
}

export function createAlertRule(data) {
  return fetch(`${API_BASE}/api/alerts/rules`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": getUserId() || "1" },
    body: JSON.stringify(data),
  }).then((r) => r.json());
}

// ── Geocoding ───────────────────────────────────────────────
export async function searchLocations(query) {
  if (!query || query.trim().length < 2) return [];
  const res = await fetch(`${API_BASE}/api/geocode?q=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  const { data } = await res.json();
  return data;
}

// ── User Locations ──────────────────────────────────────────
export async function fetchUserLocations(chatId) {
  const { data } = await api(`/api/locations?chatId=${chatId}`);
  return data;
}

export async function saveLocation({ label, latitude, longitude, radiusKm, telegramChatId }) {
  const res = await fetch(`${API_BASE}/api/locations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": getUserId() || "1" },
    body: JSON.stringify({ label, latitude, longitude, radiusKm, telegramChatId }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function deleteLocationApi(id) {
  const res = await fetch(`${API_BASE}/api/locations/${id}`, {
    method: "DELETE",
    headers: { "x-user-id": getUserId() || "1" },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

// ── Location Risk ───────────────────────────────────────────
export function fetchLocationRisk(locationId, historyHours = 168) {
  return api(`/api/locations/${locationId}/risk?historyHours=${historyHours}`);
}

export function fetchLocationContacts(locationId) {
  return api(`/api/locations/${locationId}/contacts`);
}

export async function discoverLocationContacts(locationId) {
  const res = await fetch(`${API_BASE}/api/locations/${locationId}/contacts/discover`, {
    method: "POST",
    headers: { "x-user-id": getUserId() || "1" },
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ── SSE ─────────────────────────────────────────────────────
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
      // heartbeats
    }
  };

  source.onerror = () => { };

  return { close: () => source.close(), source };
}

// ── Auth ────────────────────────────────────────────────────
export async function login(email, password) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Login failed");

  localStorage.setItem("quake_user_id", data.user.id);
  localStorage.setItem("quake_user_email", data.user.email);
  return data.user;
}

export function logout() {
  localStorage.removeItem("quake_user_id");
  localStorage.removeItem("quake_user_email");
}

