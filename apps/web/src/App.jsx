import { useEvents, useLiveEvents, useHealth, useLocations } from "./hooks/useQuakeData";
import EventCard from "./components/EventCard";
import StatCard from "./components/StatCard";
import LocationManager from "./components/LocationManager";

export default function App() {
  const { locations, locationIds, addLocation, removeLocation } = useLocations();
  const { events, loading, error, reload } = useEvents(locationIds.length > 0 ? locationIds : undefined);
  const { liveEvents, connected } = useLiveEvents(locationIds.length > 0 ? locationIds : undefined);
  const { health } = useHealth();

  // Merge live SSE events on top of polled events, deduplicate by id
  const seen = new Set();
  const allEvents = [...liveEvents, ...events].filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  const stats = health?.stats || {};
  const isFiltered = locationIds.length > 0;

  return (
    <div className="min-h-screen bg-surface font-sans">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <header className="flex items-center justify-between mb-8 pb-6 border-b border-border">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2.5">
            <span className="text-2xl">🌍</span>
            QuakeDetector
          </h1>
          <div className="flex items-center gap-2.5 px-3.5 py-2 bg-surface-card border border-border rounded-full text-xs font-medium text-slate-400">
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-green-500 animate-pulse-dot" : "bg-red-500"}`} />
            {connected ? "Live" : "Connecting..."}
          </div>
        </header>

        {/* Two-column layout: locations + stats */}
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 mb-8">
          {/* Left: Location manager */}
          <LocationManager
            locations={locations}
            onAdd={addLocation}
            onRemove={removeLocation}
          />

          {/* Right: Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-2 gap-3 content-start">
            <StatCard label="Total Events" value={stats.totalEvents ?? "—"} color="text-blue-400" icon="📡" />
            <StatCard label="Last Hour" value={stats.eventsLastHour ?? "—"} color="text-cyan-400" icon="⏱️" />
            <StatCard label="Alerts (24h)" value={stats.alerts24h ?? "—"} color="text-yellow-400" icon="🔔" />
            <StatCard label="System" value={health?.status === "healthy" ? "OK" : "—"} color={health?.status === "healthy" ? "text-green-400" : "text-slate-500"} icon="💚" />
          </div>
        </div>

        {/* Event Feed */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <span>📋</span>
            {isFiltered ? "Earthquakes Near Your Locations" : "Recent Earthquakes (Global)"}
          </h2>
          <div className="flex items-center gap-3">
            {isFiltered && (
              <span className="text-[11px] text-blue-400/70 bg-blue-500/10 px-2 py-1 rounded">
                Filtered by {locationIds.length} location{locationIds.length > 1 ? "s" : ""}
              </span>
            )}
            <button
              onClick={reload}
              className="text-xs text-slate-500 hover:text-blue-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-surface-card"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-1.5 py-16">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
                style={{ animationDelay: `${i * 0.16}s` }}
              />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">⚠️</div>
            <p className="text-sm text-slate-500">Failed to load events. Is the API running?</p>
            <p className="text-xs text-slate-600 mt-1 font-mono">{error}</p>
          </div>
        ) : allEvents.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">{isFiltered ? "📍" : "🌎"}</div>
            <p className="text-sm text-slate-500">
              {isFiltered
                ? "No earthquakes detected near your locations recently."
                : "No events yet. Run the ingestion worker to start polling USGS."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {allEvents.map((event) => (
              <EventCard key={event.id} event={event} isNew={event._isNew} />
            ))}
          </div>
        )}

        {/* Footer */}
        <footer className="mt-12 pt-6 border-t border-border text-center text-xs text-slate-600">
          Data from{" "}
          <a href="https://earthquake.usgs.gov/" target="_blank" rel="noopener noreferrer" className="text-blue-500/70 hover:text-blue-400 transition-colors">
            USGS Earthquake Hazards Program
          </a>
          {" · "}QuakeDetector — Streaming-aware earthquake monitoring
        </footer>
      </div>
    </div>
  );
}
