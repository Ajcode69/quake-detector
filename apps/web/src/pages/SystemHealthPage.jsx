import { useOutletContext } from "react-router-dom";
import { useHealthDetailed } from "../hooks/useQuakeData";
import KPICard from "../components/shared/KPICard";
import { timeAgo, formatTimestamp } from "../utils";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar, LineChart, Line,
} from "recharts";

const chartTooltipStyle = {
  background: "#1a2332",
  border: "1px solid #2a3548",
  borderRadius: "6px",
  fontSize: "11px",
  color: "#e2e8f0",
};

// ── Poll History Timeline ───────────────────────────────────
function PollTimeline({ history }) {
  if (!history?.length) return null;

  const data = [...history].reverse().map((p) => ({
    time: new Date(p.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    status: p.status === "success" ? 1 : p.status === "stale" ? 0.5 : 0,
    responseMs: p.responseMs || 0,
    newEvents: p.newEvents || 0,
    fetched: p.eventsFetched || 0,
    revisions: p.revisions || 0,
    statusLabel: p.status,
  }));

  return (
    <div className="bg-surface-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Poll History</h3>
      </div>
      <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Status timeline */}
        <div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Poll Status</div>
          <div className="flex flex-wrap gap-0.5">
            {data.map((d, i) => (
              <div
                key={i}
                title={`${d.time}: ${d.statusLabel} (${d.responseMs}ms, ${d.newEvents} new)`}
                className={`w-3 h-6 rounded-sm transition-colors ${
                  d.status === 1 ? "bg-green-500/60" : d.status === 0.5 ? "bg-yellow-500/50" : "bg-red-500/60"
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-3 mt-2 text-[9px] text-slate-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-500/60" />Success</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-yellow-500/50" />Stale</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500/60" />Error</span>
          </div>
        </div>

        {/* Events per poll */}
        <div>
          <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Events Per Poll</div>
          <ResponsiveContainer width="100%" height={80}>
            <BarChart data={data}>
              <Bar dataKey="newEvents" fill="#3b82f6" radius={[1, 1, 0, 0]} name="New Events" />
              <Tooltip contentStyle={chartTooltipStyle} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ── Latency Chart ───────────────────────────────────────────
function LatencyChart({ history }) {
  if (!history?.length) return null;

  const data = [...history].reverse().map((p) => ({
    time: new Date(p.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    responseMs: p.responseMs || 0,
  }));

  return (
    <div className="bg-surface-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Response Latency</h3>
      </div>
      <div className="p-4">
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="latGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="time" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} unit="ms" />
            <Tooltip contentStyle={chartTooltipStyle} />
            <Area type="monotone" dataKey="responseMs" stroke="#f59e0b" fill="url(#latGrad)" strokeWidth={1.5} dot={false} name="Latency (ms)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Throughput Chart ────────────────────────────────────────
function ThroughputChart({ throughput }) {
  if (!throughput?.length) return null;

  const data = throughput.map((t) => ({
    time: new Date(t.minute).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    count: t.count,
  }));

  return (
    <div className="bg-surface-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Throughput (Events/min)</h3>
      </div>
      <div className="p-4">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis dataKey="time" tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 9, fill: "#64748b" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={chartTooltipStyle} />
            <Bar dataKey="count" fill="#22c55e" radius={[2, 2, 0, 0]} name="Events" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────
export default function SystemHealthPage() {
  const { health: quickHealth } = useOutletContext();
  const { health, loading, forceRefresh } = useHealthDetailed();

  if (loading && !health) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        {/* KPI Strip Skeletons */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="bg-surface-card border border-border rounded-lg p-3 flex flex-col justify-between h-20">
              <div className="h-3 bg-slate-800 rounded w-2/3" />
              <div className="h-5 bg-slate-800 rounded w-1/2" />
              <div className="h-2 bg-slate-800 rounded w-3/4" />
            </div>
          ))}
        </div>

        {/* Engine & Backfill Two Column Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1, 2].map((n) => (
            <div key={n} className="bg-surface-card border border-border rounded-lg p-4 space-y-3">
              <div className="h-4 bg-slate-800 rounded w-1/3" />
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex justify-between">
                    <div className="h-3 bg-slate-800 rounded w-1/4" />
                    <div className="h-3 bg-slate-800 rounded w-1/3" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Poll History Skeleton */}
        <div className="bg-surface-card border border-border rounded-lg p-4 space-y-3">
          <div className="h-4 bg-slate-800 rounded w-1/6" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="h-3 bg-slate-800 rounded w-1/4" />
              <div className="h-6 bg-slate-800 rounded w-full" />
            </div>
            <div className="space-y-2">
              <div className="h-3 bg-slate-800 rounded w-1/4" />
              <div className="h-20 bg-slate-800 rounded w-full" />
            </div>
          </div>
        </div>

        {/* Charts Grid Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[1, 2].map((n) => (
            <div key={n} className="bg-surface-card border border-border rounded-lg p-4 space-y-3">
              <div className="h-4 bg-slate-800 rounded w-1/3" />
              <div className="h-40 bg-slate-800 rounded w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!health) {
    return (
      <div className="p-4 text-center py-20">
        <div className="text-3xl mb-2">⚠️</div>
        <p className="text-sm text-slate-500">Unable to load system health data.</p>
        <p className="text-xs text-slate-600 mt-1">Is the API server running?</p>
      </div>
    );
  }

  const { ingestion, backfill, polling, dedup, alerts, recentErrors } = health;

  return (
    <div className="p-4 space-y-4 animate-fade-in">
      {/* ── KPI Strip ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <KPICard
          label="Ingestion Status"
          value={ingestion?.status?.toUpperCase() || "UNKNOWN"}
          icon={
            ingestion?.status === "running" ? "✅" :
            ingestion?.status === "offline" ? "🚨" : "⚠️"
          }
          color={ingestion?.status === "running" ? "text-green-400" : "text-red-400"}
        />
        <KPICard
          label="Poll Success Rate"
          value={ingestion?.pollSuccessRate1h != null ? `${ingestion.pollSuccessRate1h}%` : "—"}
          icon="📊"
          color={ingestion?.pollSuccessRate1h >= 90 ? "text-green-400" : "text-amber-400"}
          sub="Last hour"
        />
        <KPICard
          label="Avg Response"
          value={ingestion?.avgResponseMs != null ? `${ingestion.avgResponseMs}ms` : "—"}
          icon="⚡"
          color="text-amber-400"
        />
        <KPICard
          label="Consecutive Failures"
          value={ingestion?.consecutiveFailures ?? 0}
          icon={ingestion?.consecutiveFailures > 0 ? "🔴" : "💚"}
          color={ingestion?.consecutiveFailures > 0 ? "text-red-400" : "text-green-400"}
        />
        <KPICard
          label="Revisions (24h)"
          value={dedup?.revisions24h ?? 0}
          icon="📝"
          color="text-purple-400"
          sub={`${dedup?.totalRevisions ?? 0} total`}
        />
        <KPICard
          label="Alerts Sent (24h)"
          value={alerts?.sentLast24h ?? 0}
          icon="🔔"
          color="text-blue-400"
          sub={`${alerts?.retryPending ?? 0} pending retry`}
        />
      </div>

      {/* ── Ingestion + Backfill ────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Ingestion Status Card */}
        <div className="bg-surface-card border border-border rounded-lg p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Ingestion Engine</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Status</span>
              <span className={`flex items-center gap-1.5 text-xs font-medium ${
                ingestion?.status === "running" ? "text-green-400" : "text-red-400"
              }`}>
                <span className={`w-2 h-2 rounded-full ${ingestion?.status === "running" ? "bg-green-500 animate-pulse" : "bg-red-500"}`} />
                {ingestion?.status?.toUpperCase() || "UNKNOWN"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Last Poll</span>
              <span className="text-xs text-slate-300 font-mono">{ingestion?.lastPoll ? timeAgo(ingestion.lastPoll.polledAt) : "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Last Poll Events</span>
              <span className="text-xs text-slate-300 font-mono">
                {ingestion?.lastPoll ? `${ingestion.lastPoll.eventsFetched} fetched, ${ingestion.lastPoll.newEvents} new` : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Response Time</span>
              <span className="text-xs text-slate-300 font-mono">{ingestion?.lastPoll?.responseMs ?? "—"}ms</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Total Polls Tracked</span>
              <span className="text-xs text-slate-300 font-mono">{ingestion?.totalPollsTracked ?? 0}</span>
            </div>
          </div>
        </div>

        {/* Backfill Status Card */}
        <div className="bg-surface-card border border-border rounded-lg p-4">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Backfill Status</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Status</span>
              <span className={`text-xs font-medium ${
                backfill?.status === "success" ? "text-green-400" :
                backfill?.status === "running" ? "text-blue-400 animate-pulse" :
                backfill?.status === "failed" ? "text-red-400" : "text-slate-500"
              }`}>
                {backfill?.status?.toUpperCase() || "NOT STARTED"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Events Processed</span>
              <span className="text-xs text-slate-300 font-mono">{backfill?.eventsTotal ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">Events Upserted</span>
              <span className="text-xs text-slate-300 font-mono">{backfill?.eventsUpserted ?? 0}</span>
            </div>
            {backfill?.lastRun && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Started</span>
                  <span className="text-xs text-slate-300 font-mono">{formatTimestamp(backfill.lastRun.startedAt)}</span>
                </div>
                {backfill.lastRun.completedAt && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">Completed</span>
                    <span className="text-xs text-slate-300 font-mono">{formatTimestamp(backfill.lastRun.completedAt)}</span>
                  </div>
                )}
              </>
            )}
            {/* Progress bar */}
            {backfill?.eventsTotal > 0 && (
              <div className="mt-2">
                <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (backfill.eventsUpserted / backfill.eventsTotal) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Charts ─────────────────────────────────────────── */}
      <PollTimeline history={polling?.history} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <LatencyChart history={polling?.history} />
        <ThroughputChart throughput={polling?.throughput} />
      </div>

      {/* ── Alert Queue ────────────────────────────────────── */}
      <div className="bg-surface-card border border-border rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Alert Pipeline</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-surface rounded-md p-3 text-center">
            <div className="text-lg font-bold text-green-400 font-mono">{alerts?.sentLast24h ?? 0}</div>
            <div className="text-[9px] text-slate-500 uppercase">Sent (24h)</div>
          </div>
          <div className="bg-surface rounded-md p-3 text-center">
            <div className="text-lg font-bold text-red-400 font-mono">{alerts?.failedLast24h ?? 0}</div>
            <div className="text-[9px] text-slate-500 uppercase">Failed (24h)</div>
          </div>
          <div className="bg-surface rounded-md p-3 text-center">
            <div className="text-lg font-bold text-amber-400 font-mono">{alerts?.retryPending ?? 0}</div>
            <div className="text-[9px] text-slate-500 uppercase">Retry Queue</div>
          </div>
          <div className="bg-surface rounded-md p-3 text-center">
            <div className="text-lg font-bold text-blue-400 font-mono">{alerts?.totalLast24h ?? 0}</div>
            <div className="text-[9px] text-slate-500 uppercase">Total (24h)</div>
          </div>
        </div>
      </div>

      {/* ── Recent Errors ──────────────────────────────────── */}
      {recentErrors && recentErrors.length > 0 && (
        <div className="bg-surface-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Recent Errors ({recentErrors.length})</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full ops-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Response</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {recentErrors.map((err, i) => (
                  <tr key={i}>
                    <td className="font-mono text-xs">{formatTimestamp(err.timestamp)}</td>
                    <td>
                      <span className={`ops-badge ${
                        err.status === "error" ? "bg-red-500/15 text-red-400" : "bg-yellow-500/15 text-yellow-400"
                      }`}>
                        {err.status}
                      </span>
                    </td>
                    <td className="font-mono text-xs">{err.responseMs ?? "—"}ms</td>
                    <td className="text-xs text-red-400/70 max-w-[300px] truncate">{err.error || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Dedup Stats ────────────────────────────────────── */}
      <div className="bg-surface-card border border-border rounded-lg p-4">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Deduplication & Revisions</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-surface rounded-md p-3">
            <div className="text-[9px] text-slate-500 uppercase tracking-wider">Total Revisions</div>
            <div className="text-lg font-bold text-purple-400 font-mono mt-1">{dedup?.totalRevisions ?? 0}</div>
          </div>
          <div className="bg-surface rounded-md p-3">
            <div className="text-[9px] text-slate-500 uppercase tracking-wider">Revisions (24h)</div>
            <div className="text-lg font-bold text-purple-400 font-mono mt-1">{dedup?.revisions24h ?? 0}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
