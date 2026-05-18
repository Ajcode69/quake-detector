import { useState, useRef, useCallback } from "react";
import { searchLocations } from "../api";

export default function LocationSearch({ onSelect, disabled }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef(null);

  const handleSearch = useCallback((value) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const data = await searchLocations(value);
      setResults(data);
      setOpen(data.length > 0);
      setLoading(false);
    }, 400);
  }, []);

  const handleSelect = (location) => {
    onSelect(location);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 200)}
            placeholder="Search a city..."
            disabled={disabled}
            className="w-full px-4 py-2.5 bg-surface-card border border-border rounded-lg
                       text-sm text-slate-100 placeholder-slate-500
                       focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20
                       disabled:opacity-40 disabled:cursor-not-allowed
                       transition-all"
          />
          {loading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full mt-1 w-full bg-surface-card border border-border rounded-lg shadow-xl shadow-black/40 overflow-hidden">
          {results.map((r, i) => (
            <button
              key={`${r.lat}-${r.lon}-${i}`}
              onMouseDown={() => handleSelect(r)}
              className="w-full text-left px-4 py-3 text-sm hover:bg-surface-card-hover
                         border-b border-border/50 last:border-0 transition-colors"
            >
              <div className="font-medium text-slate-200">{r.shortName}</div>
              <div className="text-xs text-slate-500 mt-0.5 truncate">{r.displayName}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
