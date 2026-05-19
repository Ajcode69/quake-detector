import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useLocationRisk } from "../hooks/useQuakeData";
import { searchLocations } from "../api";
import WorldMap from "../components/map/WorldMap";
import { riskColorClass, scoreToLevel, timeAgo, formatTimestamp, getEventTime, magColorClass, getChatId } from "../utils";
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  BarChart, Bar,
} from "recharts";

// ── Location Picker ─────────────────────────────────────────
function LocationPicker({ onAdd, currentCount }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = async (q) => {
    setQuery(q);
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    const r = await searchLocations(q);
    setResults(r || []);
    setSearching(false);
  };

  return (
    <div className="bg-surface-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-300">Monitor Locations</h2>
        <span className="text-[10px] text-slate-500">{currentCount}/3 slots used</span>
      </div>
      {currentCount < 3 ? (
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search city or location..."
            className="w-full bg-surface border border-border rounded-md px-3 py-2 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50"
          />
          {results.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-surface-card border border-border rounded-md overflow-hidden z-20 max-h-48 overflow-y-auto">
              {results.slice(0, 10).map((r, i) => (
                <button
                  key={i}
                  onClick={() => {
                    onAdd({ label: r.shortName || r.displayName, latitude: parseFloat(r.lat), longitude: parseFloat(r.lon), radiusKm: 500 });
                    setQuery(""); setResults([]);
                  }}
                  className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-surface-card-hover transition-colors border-b border-border/50 last:border-0"
                >
                  {r.displayName || r.shortName}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-[10px] text-amber-400/70">Maximum 3 locations. Remove one to add another.</p>
      )}
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
      <div className="bg-surface-card border border-border rounded-lg p-4">
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
    <div className="bg-surface-card border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
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
              activeSeries.includes(s.key) ? "opacity-100" : "opacity-30"
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
    <div className="bg-surface-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border">
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

// ── Location Card ───────────────────────────────────────────
function LocationCard({ location, riskScores, onRemove, onSelectEvent }) {
  const { riskData, loading } = useLocationRisk(location.id);
  const liveScore = riskScores?.[location.id];

  const current = liveScore || riskData?.current;
  const score = current?.displayedRisk ?? 0;
  const level = current?.riskLevel || scoreToLevel(score);
  const c = riskColorClass(level);
  const counts = riskData?.eventCounts || {};
  const swarm = riskData?.swarm || { active: false };
  const nearbyEvents = (riskData?.nearbyEvents || []).slice(0, 10);
  const thresholds = riskData?.alertThresholds || [];

  return (
    <div className={`bg-surface-card border rounded-lg overflow-hidden ${score >= 75 ? "border-red-500/40 glow-critical" : score >= 50 ? "border-orange-500/30 glow-warning" : "border-border"}`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white">{location.label}</h3>
          <p className="text-[10px] text-slate-500 font-mono mt-0.5">
            {location.latitude?.toFixed(2)}°, {location.longitude?.toFixed(2)}° · {location.radiusKm}km radius
          </p>
        </div>
        <button onClick={() => onRemove(location.id)} className="text-slate-600 hover:text-red-400 text-xs transition-colors">✕</button>
      </div>

      {loading ? (
        <div className="p-8 text-center"><div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto" /></div>
      ) : (
        <div className="p-4 space-y-4">
          {/* Risk Gauge + Swarm */}
          <div className="flex items-center gap-4">
            <RiskGauge score={score} level={level} />
            <div className="flex-1 space-y-2">
              {swarm.active && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-md px-3 py-2 animate-pulse">
                  <div className="text-xs font-bold text-red-400">🔄 SWARM DETECTED</div>
                  <div className="text-[10px] text-red-400/70">{swarm.count} events, max M{swarm.maxMag}</div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                <div className="bg-surface rounded px-2 py-1.5">
                  <div className="text-[9px] text-slate-500 uppercase">24h Events</div>
                  <div className="text-sm font-bold text-slate-200 font-mono">{counts.count24h ?? "—"}</div>
                </div>
                <div className="bg-surface rounded px-2 py-1.5">
                  <div className="text-[9px] text-slate-500 uppercase">7d Events</div>
                  <div className="text-sm font-bold text-slate-200 font-mono">{counts.count7d ?? "—"}</div>
                </div>
                <div className="bg-surface rounded px-2 py-1.5">
                  <div className="text-[9px] text-slate-500 uppercase">Within 100km</div>
                  <div className="text-sm font-bold text-slate-200 font-mono">{counts.within100km ?? "—"}</div>
                </div>
                <div className="bg-surface rounded px-2 py-1.5">
                  <div className="text-[9px] text-slate-500 uppercase">Max Mag 24h</div>
                  <div className="text-sm font-bold text-amber-400 font-mono">{counts.maxMag24h ? `M${counts.maxMag24h.toFixed(1)}` : "—"}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Grafana-style Time Series */}
          {riskData?.timeSeries && (
            <TimeSeriesPanel timeSeries={riskData.timeSeries} title={`Risk Trend — ${location.label}`} />
          )}

          {/* Activity Bar Chart */}
          {riskData?.timeSeries && <ActivityBarChart timeSeries={riskData.timeSeries} />}

          {/* Mini Map */}
          <div className="rounded-lg overflow-hidden border border-border" style={{ height: 180 }}>
            <WorldMap
              events={nearbyEvents}
              onSelectEvent={onSelectEvent}
              height="180px"
              center={[location.latitude, location.longitude]}
              zoom={6}
            />
          </div>

          {/* Nearby Events */}
          {nearbyEvents.length > 0 && (
            <div>
              <h4 className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1.5">Recent Nearby Events</h4>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {nearbyEvents.map((ev) => {
                  const mag = parseFloat(ev.mag) || 0;
                  const colors = magColorClass(mag);
                  return (
                    <div
                      key={ev.id}
                      onClick={() => onSelectEvent(ev)}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-card-hover cursor-pointer transition-colors"
                    >
                      <span className={`text-[10px] font-bold font-mono w-8 ${colors.text}`}>M{mag.toFixed(1)}</span>
                      <span className="text-[10px] text-slate-400 truncate flex-1">{ev.place || "Unknown"}</span>
                      <span className="text-[9px] text-slate-600 font-mono">{Math.round(ev.distanceKm)}km</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Alert Thresholds */}
          <div className="bg-surface rounded-md px-3 py-2">
            <h4 className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-1">Active Thresholds</h4>
            {thresholds.length > 0 ? (
              thresholds.map((t) => (
                <div key={t.id} className="text-[10px] text-slate-400">
                  Alert if M ≥ {t.minMag} within {location.radiusKm}km
                  {t.alertOnTsunami && " · Tsunami alerts ON"}
                </div>
              ))
            ) : (
              <div className="text-[10px] text-slate-400">
                Default: M ≥ 3.0 within {location.radiusKm}km
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────
export default function LocationsPage() {
  const { locations, addLocation, removeLocation, riskScores, setSelectedEvent } = useOutletContext();

  return (
    <div className="p-4 space-y-4 animate-fade-in">
      <LocationPicker onAdd={addLocation} currentCount={locations.length} />

      {locations.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">📍</div>
          <p className="text-sm text-slate-500">No locations monitored. Search and add a city above.</p>
          <p className="text-xs text-slate-600 mt-1">You can monitor up to 3 locations for personalized risk scoring.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {locations.map((loc) => (
            <LocationCard
              key={loc.id}
              location={loc}
              riskScores={riskScores}
              onRemove={removeLocation}
              onSelectEvent={setSelectedEvent}
            />
          ))}
        </div>
      )}
    </div>
  );
}
