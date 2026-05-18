import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useAlerts } from "../hooks/useQuakeData";
import { fetchAlertRules, updateAlertRule, createAlertRule } from "../api";
import { useEffect } from "react";
import { severityColor, timeAgo, formatTimestamp, getChatId } from "../utils";
import SeverityBadge from "../components/shared/SeverityBadge";

const TABS = [
  { key: "realtime", label: "Real-Time Alerts", icon: "🔔" },
  { key: "rules", label: "Alert Rules", icon: "⚙️" },
  { key: "delivery", label: "Delivery Logs", icon: "📤" },
];

const SEVERITY_FILTERS = [
  { key: "", label: "All" },
  { key: "critical", label: "Critical" },
  { key: "warning", label: "Warning" },
  { key: "info", label: "Info" },
];

// ── Alert Rules Tab ─────────────────────────────────────────
function AlertRulesTab({ locations }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const chatId = getChatId();

  useEffect(() => {
    fetchAlertRules(chatId)
      .then((r) => setRules(r.data || []))
      .catch(() => setRules([]))
      .finally(() => setLoading(false));
  }, [chatId]);

  const handleToggle = async (rule) => {
    try {
      await updateAlertRule(rule.id, { enabled: !rule.enabled });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)));
    } catch { /* silent */ }
  };

  const handleCreateDefault = async () => {
    if (locations.length === 0) return;
    for (const loc of locations) {
      try {
        await createAlertRule({ chatId, locationId: loc.id, minMag: 3.0 });
      } catch { /* might already exist */ }
    }
    // Reload
    const r = await fetchAlertRules(chatId);
    setRules(r.data || []);
  };

  if (loading) return <div className="p-8 text-center"><div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto" /></div>;

  return (
    <div className="space-y-3">
      {rules.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-3xl mb-2">⚙️</div>
          <p className="text-sm text-slate-500">No custom alert rules configured.</p>
          <p className="text-xs text-slate-600 mt-1">Default rules (M ≥ 3.0) apply to all locations.</p>
          {locations.length > 0 && (
            <button onClick={handleCreateDefault} className="mt-3 px-4 py-1.5 bg-blue-500/20 border border-blue-500/30 rounded-md text-xs text-blue-400 hover:bg-blue-500/30 transition-colors">
              Create Default Rules
            </button>
          )}
        </div>
      ) : (
        rules.map((rule) => (
          <div key={rule.id} className="bg-surface-card border border-border rounded-lg p-4 flex items-center gap-4">
            <div className="flex-1">
              <div className="text-sm font-semibold text-slate-300">
                📍 {rule.location?.label || "Global Rule"}
              </div>
              <div className="text-xs text-slate-500 mt-1 space-x-3">
                <span>Min Mag: <strong className="text-amber-400">M{rule.minMag}</strong></span>
                <span>Tsunami: <strong className={rule.alertOnTsunami ? "text-green-400" : "text-slate-600"}>{rule.alertOnTsunami ? "ON" : "OFF"}</strong></span>
                <span>PAGER: <strong className="text-orange-400">{(rule.alertOnPager || []).join(", ") || "—"}</strong></span>
                {rule.quietHoursStart != null && (
                  <span>Quiet: <strong className="text-slate-400">{rule.quietHoursStart}:00–{rule.quietHoursEnd}:00 UTC</strong></span>
                )}
              </div>
            </div>
            <button
              onClick={() => handleToggle(rule)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                rule.enabled
                  ? "bg-green-500/15 text-green-400 border border-green-500/30"
                  : "bg-slate-700/30 text-slate-500 border border-border"
              }`}
            >
              {rule.enabled ? "Enabled" : "Disabled"}
            </button>
          </div>
        ))
      )}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────
export default function NotificationsPage() {
  const { locations } = useOutletContext();
  const [tab, setTab] = useState("realtime");
  const [severityFilter, setSeverityFilter] = useState("");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const { alerts, totalCount, summary, loading } = useAlerts({
    severity: severityFilter || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  return (
    <div className="p-4 space-y-4 animate-fade-in">
      {/* Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {[
          { label: "Critical", value: summary.critical ?? 0, color: "text-red-400", bg: "bg-red-500/10" },
          { label: "Warning", value: summary.warning ?? 0, color: "text-amber-400", bg: "bg-amber-500/10" },
          { label: "Info", value: summary.info ?? 0, color: "text-blue-400", bg: "bg-blue-500/10" },
          { label: "System", value: summary.system ?? 0, color: "text-purple-400", bg: "bg-purple-500/10" },
          { label: "Sent", value: summary.sent ?? 0, color: "text-green-400", bg: "bg-green-500/10" },
          { label: "Failed", value: summary.failed ?? 0, color: "text-red-400", bg: "bg-red-500/10" },
          { label: "Pending", value: summary.unsent ?? 0, color: "text-amber-400", bg: "bg-amber-500/10" },
        ].map((s) => (
          <div key={s.label} className={`${s.bg} border border-border rounded-lg px-3 py-2`}>
            <div className="text-[9px] text-slate-500 uppercase tracking-wider">{s.label}</div>
            <div className={`text-lg font-bold font-mono ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0.5 bg-surface-card border border-border rounded-lg p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              tab === t.key ? "bg-slate-700/50 text-white" : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {tab === "realtime" && (
        <div className="space-y-3">
          {/* Severity Filter */}
          <div className="flex items-center gap-1">
            {SEVERITY_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => { setSeverityFilter(f.key); setPage(0); }}
                className={`px-2.5 py-1 text-[10px] font-bold rounded transition-all ${
                  severityFilter === f.key ? "bg-blue-500/20 text-blue-400" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {f.label}
              </button>
            ))}
            <span className="text-[10px] text-slate-600 ml-auto font-mono">{totalCount} alerts</span>
          </div>

          {/* Alert List */}
          {loading && alerts.length === 0 ? (
            <div className="text-center py-12"><div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin mx-auto" /></div>
          ) : alerts.length === 0 ? (
            <div className="text-center py-12 text-sm text-slate-600">No alerts found</div>
          ) : (
            <div className="space-y-1.5">
              {alerts.map((alert) => {
                const sc = severityColor(alert.severity);
                return (
                  <div
                    key={alert.id}
                    className={`bg-surface-card border rounded-lg px-4 py-3 ${sc.border} ${
                      alert.severity === "critical" ? "glow-critical" : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${sc.dot}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <SeverityBadge severity={alert.severity} />
                          <span className="ops-badge bg-slate-700/30 text-slate-400">{alert.ruleType}</span>
                          {alert.isRevision && <span className="ops-badge bg-amber-500/10 text-amber-400">REVISED</span>}
                        </div>
                        {alert.earthquake && (
                          <div className="text-xs text-slate-400 mb-1">
                            M{alert.earthquake.mag?.toFixed(1)} — {alert.earthquake.place}
                          </div>
                        )}
                        <div className="text-[11px] text-slate-500 line-clamp-2">{alert.message?.substring(0, 200)}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] text-slate-500">{timeAgo(alert.createdAt)}</div>
                        <div className={`text-[9px] mt-0.5 ${alert.sent ? "text-green-400" : "text-amber-400"}`}>
                          {alert.sent ? "✓ Sent" : "⏳ Pending"}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination */}
          {totalCount > PAGE_SIZE && (
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
              </span>
              <div className="flex gap-1">
                <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="px-2 py-1 text-xs rounded bg-surface border border-border text-slate-400 disabled:opacity-30 transition-colors">← Prev</button>
                <button onClick={() => setPage(page + 1)} disabled={(page + 1) * PAGE_SIZE >= totalCount} className="px-2 py-1 text-xs rounded bg-surface border border-border text-slate-400 disabled:opacity-30 transition-colors">Next →</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "rules" && <AlertRulesTab locations={locations} />}

      {tab === "delivery" && (
        <div className="space-y-1.5">
          {alerts.length === 0 ? (
            <div className="text-center py-12 text-sm text-slate-600">No delivery logs available</div>
          ) : (
            <div className="bg-surface-card border border-border rounded-lg overflow-hidden">
              <table className="w-full ops-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Severity</th>
                    <th>Rule</th>
                    <th>Event</th>
                    <th>Status</th>
                    <th>Sent At</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((a) => (
                    <tr key={a.id}>
                      <td className="font-mono text-xs">{formatTimestamp(a.createdAt)}</td>
                      <td><SeverityBadge severity={a.severity} /></td>
                      <td className="text-xs text-slate-400">{a.ruleType}</td>
                      <td className="text-xs text-slate-400 max-w-[150px] truncate">{a.earthquake?.place || "—"}</td>
                      <td>
                        <span className={`ops-badge ${a.sent ? "bg-green-500/15 text-green-400" : "bg-amber-500/15 text-amber-400"}`}>
                          {a.sent ? "✓ Delivered" : "⏳ Pending"}
                        </span>
                      </td>
                      <td className="font-mono text-xs text-slate-500">{a.sentAt ? formatTimestamp(a.sentAt) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
