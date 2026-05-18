import { useState } from "react";
import LocationSearch from "./LocationSearch";

const MAX_LOCATIONS = 3;

export default function LocationManager({ locations, onAdd, onRemove }) {
  const [radiusKm, setRadiusKm] = useState(500);
  const isFull = locations.length >= MAX_LOCATIONS;

  const handleSelect = (geoResult) => {
    if (isFull) return;
    onAdd({
      label: geoResult.shortName,
      latitude: geoResult.lat,
      longitude: geoResult.lon,
      radiusKm,
    });
  };

  return (
    <div className="bg-surface-card border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
          <span>📍</span> Monitored Locations
        </h2>
        <span className="text-xs text-slate-500 font-mono">
          {locations.length}/{MAX_LOCATIONS}
        </span>
      </div>

      {/* Saved locations */}
      <div className="space-y-2 mb-4">
        {locations.length === 0 ? (
          <p className="text-xs text-slate-500 py-3 text-center">
            No locations yet. Search a city below to start monitoring.
          </p>
        ) : (
          locations.map((loc) => (
            <div
              key={loc.id}
              className="flex items-center justify-between px-3 py-2.5 bg-surface-secondary rounded-lg border border-border/50"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-200 truncate">{loc.label}</div>
                <div className="text-[11px] text-slate-500 mt-0.5 font-mono">
                  {loc.latitude?.toFixed(2)}°, {loc.longitude?.toFixed(2)}° · {loc.radiusKm}km radius
                </div>
              </div>
              <button
                onClick={() => onRemove(loc.id)}
                className="ml-3 px-2 py-1 text-xs text-red-400/70 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      {/* Add location */}
      {!isFull && (
        <div className="space-y-3">
          <LocationSearch onSelect={handleSelect} disabled={isFull} />

          {/* Radius selector */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">Radius:</span>
            <div className="flex gap-1">
              {[100, 250, 500, 1000].map((r) => (
                <button
                  key={r}
                  onClick={() => setRadiusKm(r)}
                  className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                    radiusKm === r
                      ? "bg-blue-500/15 border-blue-500/40 text-blue-400"
                      : "bg-transparent border-border text-slate-500 hover:border-slate-400"
                  }`}
                >
                  {r}km
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {isFull && (
        <p className="text-xs text-yellow-500/70 text-center mt-2">
          Maximum {MAX_LOCATIONS} locations reached. Remove one to add another.
        </p>
      )}
    </div>
  );
}
