import { useState, useEffect, useRef, useCallback } from "react";
import { fetchEvents, fetchHealth, connectSSE } from "../api";

/**
 * Hook: fetch events from API with polling refresh.
 */
export function useEvents(refreshInterval = 60_000) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await fetchEvents({ limit: 50 });
      setEvents(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, refreshInterval);
    return () => clearInterval(id);
  }, [load, refreshInterval]);

  return { events, loading, error, reload: load };
}

/**
 * Hook: SSE connection for live events.
 * Prepends new events to the list (newest first).
 */
export function useLiveEvents() {
  const [liveEvents, setLiveEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const connectionRef = useRef(null);

  useEffect(() => {
    const conn = connectSSE((event) => {
      setLiveEvents((prev) => [{ ...event, _isNew: true }, ...prev].slice(0, 100));
    });

    conn.source.addEventListener("open", () => setConnected(true));
    conn.source.addEventListener("error", () => setConnected(false));

    connectionRef.current = conn;

    return () => conn.close();
  }, []);

  return { liveEvents, connected };
}

/**
 * Hook: fetch system health with polling.
 */
export function useHealth(refreshInterval = 30_000) {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await fetchHealth();
        setHealth(data);
      } catch {
        setHealth(null);
      } finally {
        setLoading(false);
      }
    }

    load();
    const id = setInterval(load, refreshInterval);
    return () => clearInterval(id);
  }, [refreshInterval]);

  return { health, loading };
}
