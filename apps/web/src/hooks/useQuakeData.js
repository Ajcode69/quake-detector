import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchEvents, fetchMapEvents, fetchHealth, fetchHealthDetailed, fetchStats,
  fetchAlerts, fetchUserLocations, fetchLocationRisk,
  saveLocation, deleteLocationApi, connectSSE,
} from "../api";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { getChatId } from "../utils";

/**
 * DATA FETCHING STRATEGY:
 * ────────────────────────
 * 1. ALL routine data uses POLLING (every 10 min for events, 30s for health/stats).
 * 2. SSE is ONLY used for critical real-time alerts:
 *    - PAGER orange/red events
 *    - Tsunami warnings
 *    - Swarm detections for monitored locations
 *    - M5.0+ global events
 *    - Risk score updates from the 5-min cron
 * 3. System health is pure polling. No SSE dependency.
 */

// ── Events with pagination (POLLING — every 10 min) ─────────
export function useEvents(params = {}, refreshInterval = 600_000) {
  const [data, setData] = useState({ data: [], totalCount: 0, hasMore: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const load = useCallback(async () => {
    try {
      const currentParams = paramsRef.current;
      const result = await fetchEvents(currentParams);
      
      setData((prev) => {
        const isAppending = currentParams.offset > 0;
        const newData = isAppending ? [...prev.data, ...result.data] : result.data;
        
        // Deduplicate by ID to be safe against Strict Mode or rapid clicks
        const uniqueData = newData.filter((v, i, a) => a.findIndex(t => t.id === v.id) === i);
        
        return {
          data: uniqueData,
          totalCount: result.count || 0,
          hasMore: result.hasMore || false,
        };
      });
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load();
    const id = setInterval(() => {
      // Polling should probably only refresh the first page or we keep it simple
      if (paramsRef.current.offset === 0) load();
    }, refreshInterval);
    return () => clearInterval(id);
  }, [load, refreshInterval, JSON.stringify(params)]);

  return {
    events: data.data || [],
    totalCount: data.totalCount || 0,
    hasMore: data.hasMore,
    loading,
    error,
    reload: load,
  };
}

// ── React Query Hooks ───────────────────────────────────────
export function useMapEventsQuery(params, enabled = true) {
  return useQuery({
    queryKey: ["mapEvents", params],
    queryFn: async () => {
      const data = await fetchMapEvents(params);
      return data.data || [];
    },
    enabled,
    refetchInterval: 600000, // 10 min
  });
}

export function useTableEventsQuery(params, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["tableEvents", params],
    queryFn: async ({ pageParam = 0 }) => {
      const data = await fetchEvents({ ...params, limit: 100, offset: pageParam });
      return data;
    },
    getNextPageParam: (lastPage, allPages) => {
      const currentCount = allPages.reduce((acc, p) => acc + (p.data?.length || 0), 0);
      if (lastPage.hasMore && lastPage.data?.length === 100) {
        return currentCount; // Next offset
      }
      return undefined;
    },
    enabled,
    refetchInterval: 600000,
  });
}

// ── Stats (POLLING — every 30s) ─────────────────────────────
export function useStats(timeWindow = "24h", refreshInterval = 30_000) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = await fetchStats(timeWindow);
        if (active) setStats(data);
      } catch {
        if (active) setStats(null);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, refreshInterval);
    return () => { active = false; clearInterval(id); };
  }, [timeWindow, refreshInterval]);

  return { stats, loading };
}

// ── SSE — CRITICAL EVENTS ONLY ──────────────────────────────
// Only receives: critical alerts, PAGER orange/red, tsunami, swarm
// detections, M5.0+ events, and risk score updates.
// Routine events are handled by polling above.
export function useSSE(locationIds) {
  const [criticalEvents, setCriticalEvents] = useState([]);
  const [riskScores, setRiskScores] = useState({});
  const [connected, setConnected] = useState(false);
  const connRef = useRef(null);

  useEffect(() => {
    if (connRef.current) connRef.current.close();

    const conn = connectSSE((event) => {
      // Risk score updates from cron
      if (event.type === "risk_update" && event.scores) {
        const scoreMap = {};
        for (const score of event.scores) {
          scoreMap[score.locationId] = score;
        }
        setRiskScores((prev) => ({ ...prev, ...scoreMap }));
        return;
      }

      // Only accept critical events for live push:
      // - M5.0+ global events
      // - PAGER orange/red
      // - Tsunami warnings
      // - Events already classified as critical/warning alerts
      const mag = parseFloat(event.mag) || 0;
      const isCritical =
        mag >= 5.0 ||
        event.tsunami === 1 ||
        event.alert === "orange" ||
        event.alert === "red" ||
        event.type === "swarm_alert" ||
        event.type === "alert" ||
        event.severity === "critical" ||
        event.severity === "warning";

      if (isCritical) {
        setCriticalEvents((prev) =>
          [{ ...event, _isNew: true, _isCritical: true, _receivedAt: Date.now() }, ...prev].slice(0, 100)
        );
      }
    }, locationIds);

    conn.source.addEventListener("open", () => setConnected(true));
    conn.source.addEventListener("error", () => setConnected(false));
    connRef.current = conn;

    return () => conn.close();
  }, [JSON.stringify(locationIds)]);

  return { criticalEvents, riskScores, connected };
}

// ── Health (POLLING — every 30s) ────────────────────────────
export function useHealth(refreshInterval = 30_000) {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = await fetchHealth();
        if (active) setHealth(data);
      } catch {
        if (active) setHealth(null);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, refreshInterval);
    return () => { active = false; clearInterval(id); };
  }, [refreshInterval]);

  return { health, loading };
}

// ── Detailed Health (POLLING — every 15s) ───────────────────
export function useHealthDetailed(refreshInterval = 15_000) {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  // Manual refresh trigger
  const [refreshKey, setRefreshKey] = useState(0);
  const forceRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const data = await fetchHealthDetailed();
        if (active) setHealth(data);
      } catch {
        if (active) setHealth(null);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, refreshInterval);
    return () => { active = false; clearInterval(id); };
  }, [refreshInterval, refreshKey]);

  return { health, loading, forceRefresh };
}

// ── Alerts (POLLING — every 30s) ────────────────────────────
export function useAlerts(params = {}, refreshInterval = 30_000) {
  const [data, setData] = useState({ data: [], totalCount: 0, summary: {} });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await fetchAlerts(params);
        if (active) setData(result);
      } catch { /* silent */ }
      finally { if (active) setLoading(false); }
    }
    load();
    const id = setInterval(load, refreshInterval);
    return () => { active = false; clearInterval(id); };
  }, [JSON.stringify(params), refreshInterval]);

  return {
    alerts: data.data || [],
    totalCount: data.totalCount || 0,
    summary: data.summary || {},
    loading,
  };
}

// ── Locations with CRUD ─────────────────────────────────────
export function useLocations() {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const chatId = getChatId();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchUserLocations(chatId);
      setLocations(data);
    } catch {
      setLocations([]);
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => { load(); }, [load]);

  const addLocation = async ({ label, latitude, longitude, radiusKm }) => {
    await saveLocation({ label, latitude, longitude, radiusKm, telegramChatId: chatId });
    await load();
  };

  const removeLocation = async (id) => {
    try {
      await deleteLocationApi(id);
      setLocations((prev) => prev.filter((loc) => loc.id !== id));
    } catch (e) {
      console.error("Failed to delete location:", e);
      await load();
    }
  };

  return {
    locations,
    locationIds: locations.map((l) => l.id),
    loading,
    addLocation,
    removeLocation,
    reload: load,
  };
}

// ── Location Risk with time-series (POLLING — every 5 min) ──
export function useLocationRisk(locationId, historyHours = 168) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!locationId) return;
    let active = true;

    async function load() {
      try {
        const result = await fetchLocationRisk(locationId, historyHours);
        if (active) setData(result);
      } catch {
        if (active) setData(null);
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 300_000); // 5 min
    return () => { active = false; clearInterval(id); };
  }, [locationId, historyHours]);

  return { riskData: data, loading };
}
