import { useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { useStats, useMapEventsQuery, useTableEventsQuery } from "../hooks/useQuakeData";
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
  const [activeView, setActiveView] = useState("map"); // "map" or "table"
  const [timeWindow, setTimeWindow] = useState("24h");
  
  // Table state
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // Map filters
  const [minMagMap, setMinMagMap] = useState("");
  const [maxMagMap, setMaxMagMap] = useState("");
  const [minSigMap, setMinSigMap] = useState("");
  const [maxSigMap, setMaxSigMap] = useState("");

  // Table filters
  const [minMagFilter, setMinMagFilter] = useState("");
  const [alertFilter, setAlertFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [eventClassFilter, setEventClassFilter] = useState("");
  const [orderBy, setOrderBy] = useState("eventTime");

  const { stats, loading: statsLoading } = useStats(timeWindow);

  // ── Map Query ──────────────────────────────────────────────
  const { data: fetchedMapEvents = [], isLoading: mapLoading } = useMapEventsQuery(
    {
      timeWindow,
      minMag: minMagMap,
      maxMag: maxMagMap,
      minSig: minSigMap,
      maxSig: maxSigMap,
    },
    activeView === "map" // only fetch if map view is active
  );

  const mapEvents = useMemo(() => {
    const seen = new Set();
    const combined = [...criticalEvents, ...fetchedMapEvents];
    return combined.filter((e) => {
      if (e.type === 'cluster') return true; // keep clusters
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
  }, [criticalEvents, fetchedMapEvents]);

  // ── Table Query ────────────────────────────────────────────
  const { 
    data: tableData, 
    fetchNextPage, 
    hasNextPage, 
    isLoading: tableLoading, 
    isFetchingNextPage,
    error 
  } = useTableEventsQuery(
    {
      timeWindow,
      minMag: minMagFilter || undefined,
      alertLevel: alertFilter || undefined,
      region: regionFilter || searchQuery || undefined,
      eventClass: eventClassFilter || undefined,
      orderBy,
    },
    activeView === "table" // only fetch if table view is active
  );

  // Flatten the React Query infinite pages into a single array
  const allTableEvents = useMemo(() => {
    if (!tableData) return [];
    return tableData.pages.flatMap((page) => page.data || []);
  }, [tableData]);

  // Client-side pagination over the fetched cache
  const paginatedEvents = allTableEvents.slice(0, (page + 1) * PAGE_SIZE);
  const totalTableCount = tableData?.pages[0]?.count || 0;
  
  // Logic to load more
  const handleLoadMore = () => {
    const nextLimit = (page + 2) * PAGE_SIZE;
    if (nextLimit > allTableEvents.length && hasNextPage) {
      // We need more data from server
      fetchNextPage().then(() => setPage(page + 1));
    } else {
      // We already have it in cache
      setPage(page + 1);
    }
  };

  if (statsLoading && !stats) {
    return (
      <div className="p-4 space-y-4">
        {/* KPI Strip Skeletons */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="bg-surface-card border border-border rounded-lg p-3 animate-pulse flex flex-col justify-between h-20">
              <div className="h-3 bg-slate-800 rounded w-2/3" />
              <div className="h-5 bg-slate-800 rounded w-1/2" />
              <div className="h-2 bg-slate-800 rounded w-3/4" />
            </div>
          ))}
        </div>

        {/* View Switcher Skeleton */}
        <div className="h-14 bg-surface-card border border-border rounded-lg animate-pulse" />

        {/* Main Content Pane Skeleton */}
        <div className="space-y-4">
          <div className="h-14 bg-surface-card border border-border rounded-lg animate-pulse" />
          <div className="bg-surface-card border border-border rounded-lg animate-pulse h-[450px] flex flex-col items-center justify-center gap-2">
            <div className="w-12 h-12 rounded-full bg-slate-800" />
            <div className="h-3 bg-slate-800 rounded w-1/4" />
            <div className="h-2 bg-slate-800 rounded w-1/6" />
          </div>
        </div>
      </div>
    );
  }

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

      {/* ── View Switcher & Timeline ────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-surface-card border border-border p-3 rounded-lg">
        <div className="flex bg-surface p-1 rounded-md w-fit">
          <button 
            onClick={() => setActiveView("map")}
            className={`px-4 py-1.5 text-xs font-bold rounded-sm transition-all ${activeView === "map" ? "bg-blue-500/20 text-blue-600 dark:text-blue-400" : "text-slate-500 hover:text-slate-100"}`}
          >
            Map View
          </button>
          <button 
            onClick={() => setActiveView("table")}
            className={`px-4 py-1.5 text-xs font-bold rounded-sm transition-all ${activeView === "table" ? "bg-blue-500/20 text-blue-600 dark:text-blue-400" : "text-slate-500 hover:text-slate-100"}`}
          >
            Table View
          </button>
        </div>

        <div className="flex items-center gap-1 bg-surface rounded-md p-1">
          {TIME_WINDOWS.map((tw) => (
            <button
              key={tw.key}
              onClick={() => { 
                setTimeWindow(tw.key); 
                setPage(0); 
              }}
              className={`px-3 py-1.5 text-[10px] font-bold rounded-sm transition-all ${
                timeWindow === tw.key
                  ? "bg-slate-700 text-slate-100"
                  : "text-slate-500 hover:text-slate-100"
              }`}
            >
              {tw.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Map View ────────────────────────────────────────── */}
      {activeView === "map" && (
        <div className="space-y-4 animate-fade-in">
          {/* Map Filters */}
          <div className="flex items-center gap-4 flex-wrap bg-surface-card border border-border p-3 rounded-lg">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Magnitude Range</span>
              <div className="flex items-center gap-2">
                <input type="number" placeholder="Min" value={minMagMap} onChange={e => setMinMagMap(e.target.value)} className="w-16 bg-surface border border-border rounded px-2 py-1 text-xs text-slate-300 focus:border-blue-500/50" />
                <span className="text-slate-500">-</span>
                <input type="number" placeholder="Max" value={maxMagMap} onChange={e => setMaxMagMap(e.target.value)} className="w-16 bg-surface border border-border rounded px-2 py-1 text-xs text-slate-300 focus:border-blue-500/50" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Significance Range</span>
              <div className="flex items-center gap-2">
                <input type="number" placeholder="Min" value={minSigMap} onChange={e => setMinSigMap(e.target.value)} className="w-16 bg-surface border border-border rounded px-2 py-1 text-xs text-slate-300 focus:border-blue-500/50" />
                <span className="text-slate-500">-</span>
                <input type="number" placeholder="Max" value={maxSigMap} onChange={e => setMaxSigMap(e.target.value)} className="w-16 bg-surface border border-border rounded px-2 py-1 text-xs text-slate-300 focus:border-blue-500/50" />
              </div>
            </div>
            <div className="ml-auto text-xs text-slate-500 font-mono">
              {mapLoading ? "Loading map data..." : `Showing ${mapEvents.length} clusters & points`}
            </div>
          </div>

          <div className="bg-surface-card border border-border rounded-lg overflow-hidden" style={{ minHeight: 450 }}>
            {mapLoading && mapEvents.length === 0 ? (
              <div className="h-[450px] w-full bg-slate-900/20 animate-pulse flex flex-col items-center justify-center gap-2">
                <div className="w-12 h-12 rounded-full bg-slate-800" />
                <div className="h-3 bg-slate-800 rounded w-1/4" />
                <div className="h-2 bg-slate-800 rounded w-1/6" />
              </div>
            ) : (
              <WorldMap events={mapEvents} onSelectEvent={setSelectedEvent} height="450px" />
            )}
          </div>
        </div>
      )}

      {/* ── Table View ──────────────────────────────────────── */}
      {activeView === "table" && (
        <div className="space-y-4 animate-fade-in">
          {/* Table Filters */}
          <div className="flex items-center gap-2 flex-wrap bg-surface-card border border-border p-3 rounded-lg">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mr-2">Filters:</span>
            <select value={minMagFilter} onChange={(e) => { setMinMagFilter(e.target.value); setPage(0); }} className="bg-surface border border-border rounded-md px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-blue-500/50">
              <option value="">All Magnitudes</option>
              <option value="2">M ≥ 2.0</option>
              <option value="3">M ≥ 3.0</option>
              <option value="4">M ≥ 4.0</option>
              <option value="5">M ≥ 5.0</option>
            </select>
            <select value={alertFilter} onChange={(e) => { setAlertFilter(e.target.value); setPage(0); }} className="bg-surface border border-border rounded-md px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-blue-500/50">
              <option value="">All Alert Levels</option>
              <option value="red">🔴 Red</option>
              <option value="orange">🟠 Orange</option>
              <option value="yellow">🟡 Yellow</option>
              <option value="green">🟢 Green</option>
            </select>
            <input type="text" placeholder="Search region..." value={regionFilter} onChange={(e) => { setRegionFilter(e.target.value); setPage(0); }} className="bg-surface border border-border rounded-md px-2 py-1 text-xs text-slate-300 w-40 focus:outline-none focus:border-blue-500/50" />
            <select value={eventClassFilter} onChange={(e) => { setEventClassFilter(e.target.value); setPage(0); }} className="bg-surface border border-border rounded-md px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-blue-500/50">
              <option value="">All Event Classes</option>
              <option value="tsunami_risk">🌊 Tsunami Risk</option>
              <option value="major_quake">🔴 Major Quake</option>
            </select>
            <select value={orderBy} onChange={(e) => { setOrderBy(e.target.value); setPage(0); }} className="bg-surface border border-border rounded-md px-2 py-1 text-xs text-slate-300 focus:outline-none focus:border-blue-500/50">
              <option value="eventTime">Sort: Time</option>
              <option value="mag">Sort: Magnitude</option>
              <option value="sig">Sort: Significance</option>
            </select>
            <span className="text-[10px] text-slate-600 ml-auto font-mono flex items-center gap-2">
              {tableLoading && <span className="w-3 h-3 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />}
              {totalTableCount} events
            </span>
          </div>

          <div className={`bg-surface-card border border-border rounded-lg overflow-hidden transition-opacity ${tableLoading && paginatedEvents.length > 0 ? 'opacity-50' : 'opacity-100'}`}>
            <div className="overflow-x-auto">
              <table className="w-full ops-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Mag</th>
                    <th>Location</th>
                    <th>Depth</th>
                    <th>Class</th>
                    <th>Impact</th>
                    <th>Conf</th>
                    <th>Alert</th>
                    <th>Network</th>
                  </tr>
                </thead>
                <tbody>
                  {tableLoading && paginatedEvents.length === 0 ? (
                    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                      <tr key={n} className="animate-pulse border-b border-border/20 last:border-0">
                        <td><div className="h-4 bg-slate-800/80 rounded w-24 my-1.5" /></td>
                        <td><div className="h-5 bg-slate-800/80 rounded w-10 my-1.5" /></td>
                        <td><div className="h-4 bg-slate-800/80 rounded w-48 my-1.5" /></td>
                        <td><div className="h-4 bg-slate-800/80 rounded w-12 my-1.5" /></td>
                        <td><div className="h-4 bg-slate-800/80 rounded w-20 my-1.5" /></td>
                        <td><div className="h-4 bg-slate-800/80 rounded w-8 my-1.5" /></td>
                        <td><div className="h-4 bg-slate-800/80 rounded w-12 my-1.5" /></td>
                        <td><div className="h-5 bg-slate-800/80 rounded w-16 my-1.5" /></td>
                        <td><div className="h-4 bg-slate-800/80 rounded w-12 my-1.5" /></td>
                      </tr>
                    ))
                  ) : error ? (
                    <tr><td colSpan={9} className="text-center py-8 text-red-400/70">Error loading events</td></tr>
                  ) : paginatedEvents.length === 0 ? (
                    <tr><td colSpan={9} className="text-center py-8 text-slate-600">No events for this time window</td></tr>
                  ) : (
                    paginatedEvents.map((ev) => {
                      const mag = parseFloat(ev.mag) || 0;
                      const colors = magColorClass(mag);
                      return (
                        <tr key={ev.id} onClick={() => setSelectedEvent(ev)} className="cursor-pointer">
                          <td className="font-mono text-xs">{formatTimestamp(getEventTime(ev))}</td>
                          <td>
                            <span className={`inline-flex items-center justify-center w-10 rounded font-mono font-bold text-xs py-0.5 ${colors.bg} ${colors.text}`}>
                              {mag.toFixed(1)}
                            </span>
                          </td>
                          <td className="max-w-[200px] truncate">{ev.place || "—"}</td>
                          <td className="font-mono">{ev.depth != null ? `${parseFloat(ev.depth).toFixed(1)}` : "—"}</td>
                          <td>
                            {ev.eventClass ? <span className="text-xs text-slate-300 capitalize">{ev.eventClass.replace("_", " ")}</span> : <span className="text-slate-600">—</span>}
                          </td>
                          <td>
                            {ev.impactScore != null ? <span className={`font-mono text-xs ${ev.impactScore >= 75 ? 'text-red-400 font-bold' : 'text-slate-300'}`}>{ev.impactScore}</span> : <span className="text-slate-600">—</span>}
                          </td>
                          <td>
                            {ev.confidenceScore != null ? <span className={`font-mono text-xs ${ev.confidenceScore < 40 ? 'text-amber-400 font-bold' : 'text-slate-300'}`}>{ev.confidenceScore}%</span> : <span className="text-slate-600">—</span>}
                          </td>
                          <td>
                            {ev.alert ? <span className={`ops-badge ${alertColor(ev.alert).bg} ${alertColor(ev.alert).text}`}>{ev.alert}</span> : <span className="text-slate-600">—</span>}
                          </td>
                          <td className="font-mono text-xs text-slate-500">{ev.net?.toUpperCase() || "—"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination -> Load More */}
            {(hasNextPage || paginatedEvents.length < allTableEvents.length) && (
              <div className="flex items-center justify-center px-4 py-4 border-t border-border bg-surface">
                <button
                  onClick={handleLoadMore}
                  disabled={tableLoading || isFetchingNextPage}
                  className="px-6 py-2 text-xs font-semibold uppercase tracking-wider rounded bg-surface-card border border-border text-slate-300 hover:text-white hover:border-slate-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {isFetchingNextPage ? "Loading More..." : "Load More Events"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
