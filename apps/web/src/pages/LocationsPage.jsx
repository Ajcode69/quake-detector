import { useState } from "react";
import { useOutletContext, useParams, useNavigate } from "react-router-dom";
import { useLocationRisk } from "../hooks/useQuakeData";
import { searchLocations } from "../api";
import WorldMap from "../components/map/WorldMap";
import { riskColorClass, scoreToLevel, timeAgo, formatTimestamp, getEventTime, magColorClass } from "../utils";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  BarChart, Bar,
} from "recharts";

// ── Location Picker ─────────────────────────────────────────
function LocationPicker({ onAdd, currentCount }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);

  const handleSearch = async (q) => {
    setQuery(q);
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const r = await searchLocations(q);
      setResults(r || []);
    } catch (e) {
      console.error(e);
    } finally {
      setSearching(false);
    }
  };

  const handleSelect = async (r) => {
    setAdding(true);
    try {
      await onAdd({
        label: r.shortName || r.displayName,
        latitude: parseFloat(r.lat),
        longitude: parseFloat(r.lon),
        radiusKm: 500
      });
    } catch (e) {
      console.error("Failed to add location:", e);
    } finally {
      setAdding(false);
      setQuery("");
      setResults([]);
    }
  };

  return (
    <div className="bg-surface-card border border-border rounded-xl p-4 shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Monitor Locations</h2>
        <span className="text-[10px] text-slate-500 font-mono">{currentCount}/3 slots used</span>
      </div>
      
      {adding ? (
        <div className="w-full bg-slate-800/40 border border-blue-500/20 rounded-lg px-4 py-2.5 flex items-center justify-center gap-2.5 animate-pulse">
          <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          <span className="text-xs text-blue-400 font-medium">Registering city and calculating real-time risk scores...</span>
        </div>
      ) : currentCount < 3 ? (
        <div className="relative">
          <div className="relative flex items-center">
            <input
              type="text"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search city or location (e.g., Tokyo, San Francisco)..."
              className="w-full bg-surface border border-border rounded-lg pl-3 pr-8 py-2 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50 transition-colors"
            />
            {searching && (
              <div className="absolute right-3 w-3.5 h-3.5 border-2 border-slate-600/30 border-t-blue-500 rounded-full animate-spin" />
            )}
          </div>
          {results.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-surface-card border border-border rounded-lg overflow-hidden z-20 max-h-48 overflow-y-auto shadow-2xl">
              {results.slice(0, 10).map((r, i) => (
                <button
                  key={i}
                  onClick={() => handleSelect(r)}
                  className="w-full text-left px-3 py-2.5 text-xs text-slate-300 hover:bg-surface-card-hover transition-colors border-b border-border/50 last:border-0 flex items-center justify-between"
                >
                  <span className="font-medium truncate mr-2">{r.displayName || r.shortName}</span>
                  <span className="text-[10px] text-slate-500 font-mono shrink-0">
                    {parseFloat(r.lat).toFixed(2)}°, {parseFloat(r.lon).toFixed(2)}°
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-[10px] text-amber-400/80 bg-amber-400/5 border border-amber-400/15 px-3 py-2 rounded-lg leading-relaxed">
          Maximum limit reached. You can monitor up to 3 locations simultaneously. Please delete an existing location to add a new one.
        </p>
      )}
    </div>
  );
}

function MinimalLocationCard({ location, onRemove, liveScore }) {
  const navigate = useNavigate();
  
  const activeScoreObj = liveScore || location;
  const score = activeScoreObj.currentRisk ?? activeScoreObj.displayedRisk ?? 0;
  const level = activeScoreObj.riskLevel ?? "Low";
  const events24h = activeScoreObj.events24h ?? activeScoreObj.eventsInRadius24h ?? 0;
  const maxMag24h = activeScoreObj.maxMag24h ?? activeScoreObj.largestMag24h ?? null;
  const colors = riskColorClass(level);

  // Dynamic colors for telemetry elements based on level
  const radarColors =
    score >= 75
      ? { ring: "border-red-500/30", ping: "bg-red-500", glow: "from-red-500/10 to-transparent", text: "text-red-400" }
      : score >= 50
      ? { ring: "border-orange-500/25", ping: "bg-orange-500", glow: "from-orange-500/5 to-transparent", text: "text-orange-400" }
      : score >= 25
      ? { ring: "border-amber-500/20", ping: "bg-amber-500", glow: "from-amber-500/5 to-transparent", text: "text-amber-400" }
      : { ring: "border-emerald-500/20", ping: "bg-emerald-500", glow: "from-emerald-500/5 to-transparent", text: "text-emerald-400" };

  return (
    <div
      onClick={() => navigate(`/locations/${location.id}`)}
      className={`group relative bg-surface-card border rounded-xl p-4 cursor-pointer hover:bg-surface-card-hover hover:-translate-y-0.5 transition-all duration-300 shadow-md h-[340px] flex flex-col justify-between ${
        score >= 75
          ? "border-red-500/30 shadow-red-950/10 hover:border-red-500/50 hover:shadow-red-500/5"
          : score >= 50
          ? "border-orange-500/20 shadow-orange-950/10 hover:border-orange-500/40 hover:shadow-orange-500/5"
          : score >= 25
          ? "border-amber-500/25 shadow-amber-950/5 hover:border-amber-500/40"
          : "border-border hover:border-slate-700"
      }`}
    >
      {/* Floating Dustbin button at top right */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (confirm(`Stop monitoring ${location.label}?`)) {
            onRemove(location.id);
          }
        }}
        className="absolute -top-1.5 -right-1.5 p-1.5 rounded-full bg-slate-900 border border-red-500/20 text-slate-400 hover:text-red-400 hover:border-red-500/40 hover:bg-red-500/10 transition-all duration-200 opacity-0 group-hover:opacity-100 shadow-lg shadow-red-950/20 z-20"
        title="Stop monitoring"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>

      {/* Top Section: Title & Label */}
      <div className="flex flex-col space-y-1">
        <h3 className="text-sm font-bold text-white group-hover:text-blue-400 transition-colors truncate">
          {location.label}
        </h3>
        <p className="text-[10px] text-slate-500 font-mono">
          {location.latitude?.toFixed(2)}°, {location.longitude?.toFixed(2)}° · {location.radiusKm}km radius
        </p>
      </div>

      {/* Picture Placeholder / Tech Radar Section */}
      <div className="my-3 w-full h-[150px] rounded-lg bg-gradient-to-b from-slate-950 to-slate-900 border border-slate-800/80 overflow-hidden relative flex flex-col items-center justify-center gap-2 group-hover:border-slate-700/60 transition-colors">
        {/* Futuristic grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:12px_12px] opacity-30" />
        
        {/* Dynamic Soft radial glow */}
        <div className={`absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.05),transparent_60%)]`} />

        {/* Telemetry Corner text overlay */}
        <div className="absolute top-2 left-2 text-[8px] font-mono text-slate-500 flex items-center gap-1">
          <span className={`w-1 h-1 rounded-full ${radarColors.ping} animate-pulse`} />
          SYS: ACTIVE
        </div>
        <div className="absolute top-2 right-2 text-[8px] font-mono text-slate-500">
          SCAN: {location.latitude?.toFixed(2)}°N / {location.longitude?.toFixed(2)}°E
        </div>
        
        <div className="absolute bottom-2 left-2 text-[7px] font-mono text-slate-600">
          RANGE: {location.radiusKm}KM
        </div>
        <div className="absolute bottom-2 right-2 text-[7px] font-mono text-slate-600">
          GRID: {level.toUpperCase()} HAZARD
        </div>

        {/* Pulsing scanner overlay line */}
        <div className="absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-blue-500/20 to-transparent animate-pulse" />

        {/* Active concentric radar waves */}
        <div className="relative w-20 h-20 flex items-center justify-center">
          {/* Outer ring */}
          <div className={`absolute w-20 h-20 rounded-full border border-dashed ${radarColors.ring} animate-spin [animation-duration:12s]`} />
          {/* Middle ring with ping animation */}
          <div className={`absolute w-14 h-14 rounded-full border border-slate-700/60`} />
          <div className={`absolute w-14 h-14 rounded-full ${radarColors.ping} opacity-10 animate-ping [animation-duration:3s]`} />
          
          {/* Inner ring */}
          <div className={`absolute w-8 h-8 rounded-full border ${radarColors.ring}`} />
          <div className={`absolute w-8 h-8 rounded-full ${radarColors.ping} opacity-20 animate-ping [animation-duration:2s]`} />

          {/* Center glowing crosshair */}
          <div className={`w-2.5 h-2.5 rounded-full ${radarColors.ping} shadow-[0_0_8px_rgba(59,130,246,0.5)] z-10`} />
          
          {/* Static crosshair tickmarks */}
          <div className="absolute w-full h-[0.5px] bg-slate-800/40 pointer-events-none" />
          <div className="absolute h-full w-[0.5px] bg-slate-800/40 pointer-events-none" />
        </div>

        {/* Floating city overlay icon/badge */}
        <span className={`text-[8px] ${radarColors.text} font-mono font-bold tracking-widest uppercase mt-0.5 z-10 flex items-center gap-1`}>
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-[6px]">🛰️</span>
          Telemetry Visualizer
        </span>
      </div>

      {/* Bottom Section: Stats & Badges */}
      <div className="flex items-center justify-between gap-4 pt-1">
        {/* Left Side: Stats Badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="bg-slate-800 text-slate-400 px-2 py-0.5 rounded text-[10px] font-medium font-mono">
            {events24h} {events24h === 1 ? "event" : "events"} / 24h
          </span>
          {maxMag24h ? (
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-amber-500/10 text-amber-400 border border-amber-500/15`}>
              M{Number(maxMag24h).toFixed(1)} max
            </span>
          ) : (
            <span className="bg-slate-800 text-slate-600 px-2 py-0.5 rounded text-[10px] font-medium font-mono">
              No 24h events
            </span>
          )}
        </div>

        {/* Right Side: Score Badge */}
        <div className="shrink-0">
          <div className={`flex flex-col items-center justify-center w-12 h-12 rounded-lg border ${colors.bg} ${colors.border}`}>
            <span className={`text-base font-extrabold font-mono leading-none ${colors.text}`}>
              {Math.round(score)}
            </span>
            <span className={`text-[8px] font-bold tracking-wider uppercase leading-none mt-1 ${colors.text}`}>
              {level}
            </span>
          </div>
        </div>
      </div>
      
      {/* Click hover micro-indicator */}
      <div className="absolute bottom-2 left-4 text-[10px] text-slate-600 font-medium group-hover:text-blue-400/80 transition-colors flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
        Analyze Report <span className="text-xs">→</span>
      </div>
    </div>
  );
}

// ── Risk Gauge (circular) ───────────────────────────────────
function RiskGauge({ score = 0, level = "Low" }) {
  const c = riskColorClass(level);
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative w-28 h-28 mx-auto">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="none" stroke="#1e293b" strokeWidth="6" />
        <circle
          cx="50" cy="50" r="40" fill="none"
          stroke={score >= 75 ? "#ef4444" : score >= 50 ? "#f97316" : score >= 25 ? "#f59e0b" : "#22c55e"}
          strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-2xl font-bold font-mono ${c.text}`}>{Math.round(score)}</span>
        <span className={`text-[9px] font-semibold uppercase tracking-wider ${c.text}`}>{level}</span>
      </div>
    </div>
  );
}

// ── Grafana-style Time Series Panel ─────────────────────────
function TimeSeriesPanel({ timeSeries, title }) {
  const [activeSeries, setActiveSeries] = useState(["displayedRisk", "staticScore", "deltaScore"]);

  if (!timeSeries || !timeSeries.points || timeSeries.points.length === 0) {
    return (
      <div className="bg-surface-card border border-border rounded-xl p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">{title}</h3>
        <div className="text-center py-8 text-xs text-slate-600">No time-series data yet. Scores are computed every 5 minutes.</div>
      </div>
    );
  }

  const chartData = timeSeries.points.map((p) => ({
    time: new Date(p.timestamp).getTime(),
    timeLabel: new Date(p.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    dateLabel: new Date(p.timestamp).toLocaleDateString([], { month: "short", day: "numeric" }),
    displayedRisk: p.displayedRisk,
    staticScore: p.staticScore,
    deltaScore: p.deltaScore,
    postEventScore: p.postEventScore,
    eventsInRadius1h: p.eventsInRadius1h,
    eventsInRadius24h: p.eventsInRadius24h,
    largestMag24h: p.largestMag24h,
  }));

  const seriesDefs = [
    { key: "displayedRisk", label: "Risk Score", color: "#ef4444" },
    { key: "staticScore", label: "Static", color: "#f59e0b" },
    { key: "deltaScore", label: "Delta (Trend)", color: "#3b82f6" },
    { key: "postEventScore", label: "Post-Event", color: "#8b5cf6" },
    { key: "eventsInRadius1h", label: "Events/1h", color: "#06b6d4" },
    { key: "eventsInRadius24h", label: "Events/24h", color: "#10b981" },
  ];

  const toggleSeries = (key) => {
    setActiveSeries((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  return (
    <div className="bg-surface-card border border-border rounded-xl overflow-hidden shadow-md">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{title}</h3>
        <span className="text-[10px] text-slate-600 font-mono">{chartData.length} data points</span>
      </div>

      {/* Legend toggles */}
      <div className="px-4 py-2 flex flex-wrap gap-2 border-b border-border/50">
        {seriesDefs.map((s) => (
          <button
            key={s.key}
            onClick={() => toggleSeries(s.key)}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
              activeSeries.includes(s.key) ? "opacity-100 bg-slate-800 text-slate-200 border border-slate-700/50" : "opacity-30 text-slate-500"
            }`}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="p-4">
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <defs>
              {seriesDefs.map((s) => (
                <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey="timeLabel"
              tick={{ fontSize: 10, fill: "#64748b" }}
              axisLine={{ stroke: "#1e293b" }}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#64748b" }}
              axisLine={{ stroke: "#1e293b" }}
              tickLine={false}
              domain={[0, "auto"]}
            />
            <Tooltip
              contentStyle={{
                background: "#1a2332",
                border: "1px solid #2a3548",
                borderRadius: "6px",
                fontSize: "11px",
                color: "#e2e8f0",
              }}
              labelFormatter={(_, payload) => {
                if (payload?.[0]?.payload) {
                  return `${payload[0].payload.dateLabel} ${payload[0].payload.timeLabel}`;
                }
                return "";
              }}
            />
            {seriesDefs.map((s) =>
              activeSeries.includes(s.key) ? (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stroke={s.color}
                  fill={`url(#grad-${s.key})`}
                  strokeWidth={1.5}
                  dot={false}
                  activeDot={{ r: 3, fill: s.color }}
                />
              ) : null
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Event Activity Bar Chart ────────────────────────────────
function ActivityBarChart({ timeSeries }) {
  if (!timeSeries?.points?.length) return null;

  // Bucket events by hour
  const buckets = {};
  timeSeries.points.forEach((p) => {
    const hour = new Date(p.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit" });
    if (!buckets[hour]) buckets[hour] = { hour, events1h: 0, maxRisk: 0 };
    buckets[hour].events1h = Math.max(buckets[hour].events1h, p.eventsInRadius1h || 0);
    buckets[hour].maxRisk = Math.max(buckets[hour].maxRisk, p.displayedRisk || 0);
  });

  const barData = Object.values(buckets).slice(-24);
  if (barData.length === 0) return null;

  return (
    <div className="bg-surface-card border border-border rounded-xl overflow-hidden shadow-md">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Event Activity Timeline</h3>
      </div>
      <div className="p-4">
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={barData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: "#1a2332", border: "1px solid #2a3548", borderRadius: "6px", fontSize: "11px", color: "#e2e8f0" }} />
            <Bar dataKey="events1h" fill="#3b82f6" radius={[2, 2, 0, 0]} name="Events/hour" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Detailed Location Analytics View ────────────────────────
function LocationDetailedView({ locationId, onBack, onRemove, riskScores, onSelectEvent }) {
  const { riskData, loading } = useLocationRisk(locationId);

  if (loading) {
    return (
      <div className="p-8 text-center min-h-[400px] flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
        <p className="text-xs text-slate-500 font-medium">Fetching detailed risk model and historical timelines...</p>
      </div>
    );
  }

  if (!riskData || !riskData.location) {
    return (
      <div className="p-8 text-center min-h-[400px] flex flex-col items-center justify-center gap-3 bg-surface-card border border-border rounded-xl">
        <span className="text-3xl">⚠️</span>
        <p className="text-sm text-slate-400 font-medium">Location not found or has been deleted.</p>
        <button onClick={onBack} className="mt-2 text-xs bg-slate-800 text-slate-300 px-3 py-1.5 rounded-md hover:bg-slate-700 transition-colors">
          Return to Locations
        </button>
      </div>
    );
  }

  const { location, current, timeSeries, swarm, nearbyEvents, alertThresholds } = riskData;
  const liveScore = riskScores?.[location.id];
  const activeCurrent = liveScore || current;
  
  const score = activeCurrent?.displayedRisk ?? 0;
  const level = activeCurrent?.riskLevel || scoreToLevel(score);
  const colors = riskColorClass(level);
  
  const counts = riskData.eventCounts || {};
  const nearbySliced = (nearbyEvents || []).slice(0, 15);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Breadcrumb & Action bar ─────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-surface-card border border-border rounded-xl px-4 py-3 shadow-md">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center justify-center w-8 h-8 rounded-lg bg-surface border border-border text-slate-400 hover:text-white hover:bg-slate-800 transition-all font-bold"
            title="Back to Locations"
          >
            ←
          </button>
          <div>
            <h1 className="text-sm font-bold text-white leading-tight">{location.label}</h1>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
              {location.latitude?.toFixed(4)}°, {location.longitude?.toFixed(4)}° · {location.radiusKm}km radius
            </p>
          </div>
        </div>
        
        <button
          onClick={() => {
            if (confirm(`Stop monitoring ${location.label}?`)) {
              onRemove(location.id);
              onBack();
            }
          }}
          className="text-xs bg-red-950/20 text-red-400 border border-red-500/25 px-3 py-1.5 rounded-lg hover:bg-red-500 hover:text-white transition-all font-medium self-start sm:self-center"
        >
          Remove Location
        </button>
      </div>

      {/* ── Core Risk Summary ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Risk Level Gauge */}
        <div className="lg:col-span-1 bg-surface-card border border-border rounded-xl p-5 flex flex-col items-center justify-center text-center shadow-md">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Location Risk Index</h3>
          <RiskGauge score={score} level={level} />
          
          <div className="mt-4 text-xs text-slate-400 leading-relaxed max-w-xs">
            Risk computed based on shallow magnitudes, recent clustering trends, and post-mainshock seismic decay.
          </div>
        </div>

        {/* Analytics Summary */}
        <div className="lg:col-span-2 bg-surface-card border border-border rounded-xl p-5 flex flex-col justify-between shadow-md">
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Live Risk Evaluation</h3>
            
            {swarm?.active && (
              <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 animate-pulse">
                <div className="text-xs font-extrabold text-red-400 flex items-center gap-1.5">
                  <span className="text-sm">🔄</span> ACTIVE SWARM DETECTED
                </div>
                <div className="text-[10px] text-red-400/80 mt-1 leading-relaxed">
                  Escalating cluster of {swarm.count} events in the past 6 hours (avg M{swarm.avgMag.toFixed(1)}, max M{swarm.maxMag.toFixed(1)}). Stay alert.
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-surface border border-border/50 rounded-lg p-3 shadow-inner">
                <div className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">24h Event Count</div>
                <div className="text-lg font-black text-slate-200 font-mono mt-1">{counts.count24h ?? 0}</div>
              </div>
              <div className="bg-surface border border-border/50 rounded-lg p-3 shadow-inner">
                <div className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">7d Event Count</div>
                <div className="text-lg font-black text-slate-200 font-mono mt-1">{counts.count7d ?? 0}</div>
              </div>
              <div className="bg-surface border border-border/50 rounded-lg p-3 shadow-inner">
                <div className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Within 100km (7d)</div>
                <div className="text-lg font-black text-slate-200 font-mono mt-1">{counts.within100km ?? 0}</div>
              </div>
              <div className="bg-surface border border-border/50 rounded-lg p-3 shadow-inner">
                <div className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Max Magnitude (24h)</div>
                <div className="text-lg font-black text-amber-400 font-mono mt-1 font-extrabold">
                  {counts.maxMag24h ? `M${counts.maxMag24h.toFixed(1)}` : "—"}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-border/60">
            <h4 className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Action Guidance</h4>
            <div className={`text-xs p-3 rounded-lg border leading-relaxed ${
              score >= 75 ? "bg-red-500/5 border-red-500/20 text-red-400 font-medium"
              : score >= 50 ? "bg-orange-500/5 border-orange-500/20 text-orange-400 font-medium"
              : score >= 25 ? "bg-amber-500/5 border-amber-500/20 text-amber-400 font-medium"
              : "bg-green-500/5 border-green-500/10 text-green-400 font-medium"
            }`}>
              {activeCurrent?.actionGuidance?.message || "No immediate action required. Continue routine monitoring."}
            </div>
          </div>
        </div>
      </div>

      {/* ── Time-Series & Activity Charts ────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2">
          {timeSeries && (
            <TimeSeriesPanel timeSeries={timeSeries} title="Seismic Risk Factor Historical Trend" />
          )}
        </div>
        <div className="xl:col-span-1 flex flex-col gap-6">
          {timeSeries && <ActivityBarChart timeSeries={timeSeries} />}
          
          {/* Active Alert Rules/Thresholds */}
          <div className="bg-surface-card border border-border rounded-xl p-5 flex-1 shadow-md">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Configured Thresholds</h3>
            <div className="space-y-3">
              {alertThresholds && alertThresholds.length > 0 ? (
                alertThresholds.map((t) => (
                  <div key={t.id} className="bg-surface border border-border/50 rounded-lg p-3 flex items-start gap-2.5 shadow-sm">
                    <span className="text-xs text-blue-400 mt-0.5">🔔</span>
                    <div>
                      <div className="text-xs font-semibold text-slate-200">Mag Threshold: M{t.minMag.toFixed(1)}</div>
                      <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                        Alert if magnitude exceeds limit within {location.radiusKm}km.{t.alertOnTsunami ? " Tsunami warning alerts enabled." : ""}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="bg-surface border border-border/50 rounded-lg p-3 flex items-start gap-2.5 shadow-sm">
                  <span className="text-xs text-slate-500 mt-0.5">⚙️</span>
                  <div>
                    <div className="text-xs font-semibold text-slate-400">Default Alarm Levels</div>
                    <p className="text-[10px] text-slate-550 mt-1 leading-relaxed">
                      Alert trigger defaults: M ≥ 3.0 earthquakes registered within {location.radiusKm}km radius of the monitor point.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Spatial Map & List ──────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* World Map */}
        <div className="bg-surface-card border border-border rounded-xl overflow-hidden p-5 space-y-3 shadow-md">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Spatial Activity Map (30d)</h3>
          <div className="rounded-lg overflow-hidden border border-border shadow-inner" style={{ height: 260 }}>
            <WorldMap
              events={nearbySliced}
              onSelectEvent={onSelectEvent}
              height="260px"
              center={[location.latitude, location.longitude]}
              zoom={5}
            />
          </div>
        </div>

        {/* Nearby Events List */}
        <div className="bg-surface-card border border-border rounded-xl p-5 flex flex-col shadow-md">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Recent Spatial Incidents (30d)</h3>
          {nearbySliced.length > 0 ? (
            <div className="space-y-1.5 overflow-y-auto max-h-[260px] pr-1.5 flex-1 custom-scrollbar">
              {nearbySliced.map((ev) => {
                const mag = parseFloat(ev.mag) || 0;
                const colors = magColorClass(mag);
                return (
                  <div
                    key={ev.id}
                    onClick={() => onSelectEvent(ev)}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-surface border border-border/40 hover:bg-surface-card-hover cursor-pointer transition-colors shadow-sm"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`text-[10px] font-extrabold font-mono w-10 text-center py-0.5 rounded shrink-0 ${colors.bg} ${colors.text}`}>
                        M{mag.toFixed(1)}
                      </span>
                      <span className="text-xs text-slate-300 font-medium truncate">
                        {ev.place || "Unknown Event Location"}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[10px] text-slate-500 font-mono">
                        {Math.round(ev.distanceKm)}km
                      </span>
                      <span className="text-[9px] text-slate-600 font-mono hidden sm:inline">
                        {timeAgo(ev.eventTime)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
              <span className="text-2xl mb-1.5">📭</span>
              <p className="text-xs text-slate-500">No earthquakes recorded within {location.radiusKm}km radius over the past 30 days.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────
export default function LocationsPage() {
  const { locations, locationsLoading, addLocation, removeLocation, riskScores, setSelectedEvent } = useOutletContext();
  const { id } = useParams();
  const navigate = useNavigate();

  // If loading and we have no locations cached yet, render skeletons
  if (locationsLoading && locations.length === 0) {
    return (
      <div className="p-4 space-y-4">
        {/* Skeleton Picker */}
        <div className="h-24 bg-surface-card border border-border rounded-xl animate-pulse" />
        
        {/* Skeleton Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((n) => (
            <div key={n} className="bg-surface-card border border-border rounded-xl h-[340px] p-4 animate-pulse flex flex-col justify-between">
              <div className="space-y-2">
                <div className="h-3.5 bg-slate-800 rounded w-1/3" />
                <div className="h-2 bg-slate-800 rounded w-1/2" />
              </div>
              <div className="my-3 w-full h-[150px] bg-slate-800/40 rounded-lg border border-slate-800/50" />
              <div className="flex items-center justify-between">
                <div className="h-5 bg-slate-800 rounded w-1/2" />
                <div className="h-10 w-10 bg-slate-800 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Dual layout routing logic
  if (id) {
    const locId = parseInt(id);
    return (
      <div className="p-4">
        <LocationDetailedView
          locationId={locId}
          onBack={() => navigate("/locations")}
          onRemove={removeLocation}
          riskScores={riskScores}
          onSelectEvent={setSelectedEvent}
        />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 animate-fade-in">
      <LocationPicker onAdd={addLocation} currentCount={locations.length} />

      {locations.length === 0 ? (
        <div className="text-center py-16 bg-surface-card border border-border rounded-xl shadow-inner">
          <div className="text-4xl mb-3">📍</div>
          <p className="text-sm font-semibold text-slate-300">No locations monitored</p>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">
            Search for a city above (e.g. "Tokyo", "San Francisco") and register it to start tracking personalized seismic risk indexes.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {locations.map((loc) => (
            <MinimalLocationCard
              key={loc.id}
              location={loc}
              onRemove={removeLocation}
              liveScore={riskScores?.[loc.id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}
