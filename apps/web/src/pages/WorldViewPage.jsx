import { useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { useEvents, useStats } from "../hooks/useQuakeData";
import KPICard from "../components/shared/KPICard";
import WorldMap from "../components/map/WorldMap";
import { magColorClass, alertColor, timeAgo, formatTimestamp, getEventTime, severityColor } from "../utils";

const TIME_WINDOWS = [
  { key: "1h", label: "1H" },
  { key: "24h", label: "24H" },
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
];

export default function WorldViewPage() {
  const { criticalEvents, setSelectedEvent, searchQuery } = useOutletContext();
  const [timeWindow, setTimeWindow] = useState("24h");
  const [page, setPage] = useState(0);
  const [minMagFilter, setMinMagFilter] = useState("");
  const [alertFilter, setAlertFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [orderBy, setOrderBy] = useState("eventTime");
  const PAGE_SIZE = 50;

  const { stats } = useStats(timeWindow);
  const { events, totalCount, hasMore, loading, error } = useEvents({
    timeWindow,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    minMag: minMagFilter || undefined,
    alertLevel: alertFilter || undefined,
    region: regionFilter || searchQuery || undefined,
    orderBy,
  });

  // Map uses polled events only (critical SSE events overlaid if present)
  const mapEvents = useMemo(() => {
    const seen = new Set();
    return [...criticalEvents, ...events].filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    }).slice(0, 500);
  }, [criticalEvents, events]);

  return (
    <div className="p-4 space-y-4 animate-fade-in">
      {/* ── KPI Strip ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <KPICard label="Total Events" value={stats?.totalEvents ?? "—"} icon="📡" color="text-blue-400" sub={`${timeWindow} window`} />
        <KPICard label="High Severity" value={stats?.highSeverityEvents ?? "—"} icon="⚠️" color="text-red-400" sub="M5.0+ or PAGER orange/red" />
        <KPICard label="Max Magnitude" value={stats?.maxMag ? `M${stats.maxMag.toFixed(1)}` : "—"} icon="📊" color="text-amber-400" />
        <KPICard label="Tsunami Warnings" value={stats?.tsunamiWarnings ?? 0} icon="🌊" color={stats?.tsunamiWarnings > 0 ? "text-red-400" : "text-green-400"} />
        <KPICard label="Most Active Region" value={stats?.mostActiveRegionCount ?? "—"} icon="🌐" color="text-cyan-400" sub={stats?.mostActiveRegion?.substring(0, 25) || "—"} />
        <KPICard label="Feed Status" value={stats?.feedStatus === "live" ? "LIVE" : "DOWN"} icon={stats?.feedStatus === "live" ? "💚" : "🔴"} color={stats?.feedStatus === "live" ? "text-green-400" : "text-red-400"} sub={stats?.lastSuccessfulPoll ? `${timeAgo(stats.lastSuccessfulPoll)}` : "—"} />
      </div>

      {/* ── Map + Live Feed ─────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
        {/* Map */}
        <div className="bg-surface-card border border-border rounded-lg overflow-hidden" style={{ minHeight: 420 }}>
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Global Activity</span>
            {/* Timeline Controls */}
            <div className="flex items-center gap-0.5 bg-surface rounded-md p-0.5">
              {TIME_WINDOWS.map((tw) => (
                <button
                  key={tw.key}
                  onClick={() => { setTimeWindow(tw.key); setPage(0); }}
                  className={`px-2.5 py-1 text-[10px] font-bold rounded transition-all ${
                    timeWindow === tw.key
                      ? "bg-blue-500/20 text-blue-400"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {tw.label}
                </button>
              ))}
            </div>
          </div>
          <WorldMap events={mapEvents} onSelectEvent={setSelectedEvent} height="380px" />
        </div>

        {/* Critical Alerts Feed — SSE push only for M5+, PAGER orange/red, tsunami, swarm */}
        <div className="bg-surface-card border border-border rounded-lg flex flex-col">
          <div className="px-3 py-2 border-b border-border flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Critical Alerts</span>
            <span className="text-[10px] text-slate-600 ml-auto">{criticalEvents.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto max-h-[350px] divide-y divide-border/50">
            {criticalEvents.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-600">No critical events. Routine data polled every 10 min.</div>
            ) : (
              criticalEvents.slice(0, 50).map((ev) => {
                const mag = parseFloat(ev.mag) || 0;
                const colors = magColorClass(mag);
                return (
                  <div
                    key={ev.id || ev._receivedAt}
                    onClick={() => setSelectedEvent(ev)}
                    className="px-3 py-2 hover:bg-surface-card-hover cursor-pointer transition-colors animate-slide-up"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold font-mono ${colors.text}`}>M{mag.toFixed(1)}</span>
                      <span className="text-xs text-slate-400 truncate flex-1">{ev.place || "Unknown"}</span>
                      <span className="text-[10px] text-slate-600">{timeAgo(getEventTime(ev))}</span>
                    </div>
                    {ev.tsunami === 1 && <span className="text-[9px] text-red-400 mt-0.5">🌊 Tsunami Warning</span>}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Filters:</span>
        <select
          value={minMagFilter}
          onChange={(e) => { setMinMagFilter(e.target.value); setPage(0); }}
          className="bg-surface-card border border-border rounded-md px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-blue-500/50"
        >
          <option value="">All Magnitudes</option>
          <option value="2">M ≥ 2.0</option>
          <option value="3">M ≥ 3.0</option>
          <option value="4">M ≥ 4.0</option>
          <option value="5">M ≥ 5.0</option>
          <option value="6">M ≥ 6.0</option>
        </select>
        <select
          value={alertFilter}
          onChange={(e) => { setAlertFilter(e.target.value); setPage(0); }}
          className="bg-surface-card border border-border rounded-md px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-blue-500/50"
        >
          <option value="">All Alert Levels</option>
          <option value="red">🔴 Red</option>
          <option value="orange">🟠 Orange</option>
          <option value="yellow">🟡 Yellow</option>
          <option value="green">🟢 Green</option>
        </select>
        <input
          type="text"
          placeholder="Search region..."
          value={regionFilter}
          onChange={(e) => { setRegionFilter(e.target.value); setPage(0); }}
          className="bg-surface-card border border-border rounded-md px-2 py-1 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50 w-40"
        />
        <select
          value={orderBy}
          onChange={(e) => { setOrderBy(e.target.value); setPage(0); }}
          className="bg-surface-card border border-border rounded-md px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-blue-500/50"
        >
          <option value="eventTime">Sort: Time</option>
          <option value="mag">Sort: Magnitude</option>
          <option value="sig">Sort: Significance</option>
          <option value="depth">Sort: Depth</option>
        </select>
        <span className="text-[10px] text-slate-600 ml-auto font-mono">{totalCount} events</span>
      </div>

      {/* ── Event Table ─────────────────────────────────────── */}
      <div className="bg-surface-card border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full ops-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Mag</th>
                <th>Location</th>
                <th>Depth</th>
                <th>Sig</th>
                <th>MMI</th>
                <th>Alert</th>
                <th>Status</th>
                <th>Network</th>
              </tr>
            </thead>
            <tbody>
              {loading && events.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-slate-600">Loading events...</td></tr>
              ) : error ? (
                <tr><td colSpan={9} className="text-center py-8 text-red-400/70">Error: {error}</td></tr>
              ) : events.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-8 text-slate-600">No events for this time window</td></tr>
              ) : (
                events.map((ev) => {
                  const mag = parseFloat(ev.mag) || 0;
                  const colors = magColorClass(mag);
                  return (
                    <tr
                      key={ev.id}
                      onClick={() => setSelectedEvent(ev)}
                      className="cursor-pointer"
                    >
                      <td className="font-mono text-xs">{formatTimestamp(getEventTime(ev))}</td>
                      <td>
                        <span className={`inline-flex items-center justify-center w-10 rounded font-mono font-bold text-xs py-0.5 ${colors.bg} ${colors.text}`}>
                          {mag.toFixed(1)}
                        </span>
                      </td>
                      <td className="max-w-[200px] truncate">{ev.place || "—"}</td>
                      <td className="font-mono">{ev.depth != null ? `${parseFloat(ev.depth).toFixed(1)}` : "—"}</td>
                      <td className="font-mono">{ev.sig ?? "—"}</td>
                      <td className="font-mono">{ev.mmi != null ? parseFloat(ev.mmi).toFixed(1) : "—"}</td>
                      <td>
                        {ev.alert ? (
                          <span className={`ops-badge ${alertColor(ev.alert).bg} ${alertColor(ev.alert).text}`}>
                            {ev.alert}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`text-[10px] ${ev.status === "reviewed" ? "text-green-400" : "text-slate-500"}`}>
                          {ev.status || "—"}
                        </span>
                      </td>
                      <td className="font-mono text-xs text-slate-500">{ev.net?.toUpperCase() || "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalCount > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-2 border-t border-border">
            <span className="text-[10px] text-slate-500">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-2 py-1 text-xs rounded bg-surface border border-border text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                ← Prev
              </button>
              <span className="text-[10px] text-slate-500 px-2 font-mono">
                Page {page + 1} / {Math.ceil(totalCount / PAGE_SIZE)}
              </span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={!hasMore}
                className="px-2 py-1 text-xs rounded bg-surface border border-border text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
