import { useState, useEffect, useRef, useCallback } from "react";
import { fetchEvents, fetchHealth, connectSSE, fetchUserLocations, saveLocation, deleteLocationApi } from "../api";

/**
 * Hook: fetch events with optional location filtering.
 */
export function useEvents(locationIds, refreshInterval = 60_000) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await fetchEvents({ limit: 50, locationIds });
      setEvents(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [locationIds]);

  useEffect(() => {
    setLoading(true);
    load();
    const id = setInterval(load, refreshInterval);
    return () => clearInterval(id);
  }, [load, refreshInterval]);

  return { events, loading, error, reload: load };
}

/**
 * Hook: SSE connection for live events (location-filtered).
 */
export function useLiveEvents(locationIds) {
  const [liveEvents, setLiveEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const connectionRef = useRef(null);

  useEffect(() => {
    // Close previous connection when locationIds change
    if (connectionRef.current) connectionRef.current.close();

    const conn = connectSSE((event) => {
      setLiveEvents((prev) => [{ ...event, _isNew: true }, ...prev].slice(0, 100));
    }, locationIds);

    conn.source.addEventListener("open", () => setConnected(true));
    conn.source.addEventListener("error", () => setConnected(false));
    connectionRef.current = conn;

    return () => conn.close();
  }, [locationIds]);

  return { liveEvents, connected };
}

/**
 * Hook: system health.
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

/**
 * Hook: user locations with CRUD.
 * Uses localStorage chatId for demo (in prod, this comes from auth).
 */
export function useLocations() {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);

  // For demo: generate a stable chatId in localStorage
  const chatId = getChatId();

  const load = useCallback(async () => {
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
    await deleteLocationApi(id);
    await load();
  };

  const locationIds = locations.map((l) => l.id);

  return { locations, locationIds, loading, addLocation, removeLocation };
}

function getChatId() {
  let id = localStorage.getItem("quake_chat_id");
  if (!id) {
    // Generate a demo chatId (in production this comes from Telegram auth)
    id = String(Math.floor(100000000 + Math.random() * 900000000));
    localStorage.setItem("quake_chat_id", id);
  }
  return id;
}
