import { useEffect, useState } from "react";
import { fetchEvent } from "../../api";
import { magColorClass, alertColor, timeAgo, formatTimestamp, getEventTime } from "../../utils";

export default function SideDrawer({ event, onClose }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!event) { setDetail(null); return; }
    setLoading(true);
    fetchEvent(event.id)
      .then((d) => setDetail(d))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [event?.id]);

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!event) return null;

  const mag = parseFloat(event.mag) || 0;
  const colors = magColorClass(mag);
  const eventData = detail?.data || event;
  const revisions = detail?.revisions || [];
  const nearbyLocs = detail?.nearbyLocations || [];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-[60] animate-fade-in" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-full max-w-lg bg-surface-secondary border-l border-border z-[70] overflow-y-auto animate-slide-in">
        {/* Header */}
        <div className="sticky top-0 bg-surface-secondary/95 backdrop-blur-md border-b border-border p-4 flex items-start gap-3 z-10">
          <div className={`w-14 h-14 rounded-lg flex items-center justify-center font-mono font-bold text-xl ${colors.bg} ${colors.text} border ${colors.border}`}>
            {mag.toFixed(1)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-white truncate">{eventData.place || "Unknown"}</h2>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">{eventData.id}</p>
            <p className="text-xs text-slate-400 mt-0.5">{formatTimestamp(getEventTime(eventData))}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1">
            ✕
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-5 h-5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {/* Tags */}
            <div className="flex flex-wrap gap-1.5">
              {eventData.tsunami === 1 && (
                <span className="ops-badge bg-red-500/20 text-red-400">🌊 Tsunami</span>
              )}
              {eventData.alert && (
                <span className={`ops-badge ${alertColor(eventData.alert).bg} ${alertColor(eventData.alert).text}`}>
                  PAGER: {eventData.alert}
                </span>
              )}
              {eventData.status === "reviewed" && (
                <span className="ops-badge bg-green-500/15 text-green-400">✓ Reviewed</span>
              )}
              {eventData.eventClass && (
                <span className="ops-badge bg-purple-500/10 text-purple-400">{eventData.eventClass}</span>
              )}
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Depth", value: eventData.depth != null ? `${parseFloat(eventData.depth).toFixed(1)} km` : "—" },
                { label: "Significance", value: eventData.sig ?? "—" },
                { label: "MMI", value: eventData.mmi != null ? parseFloat(eventData.mmi).toFixed(1) : "—" },
                { label: "CDI", value: eventData.cdi != null ? parseFloat(eventData.cdi).toFixed(1) : "—" },
                { label: "Felt Reports", value: eventData.felt ?? 0 },
                { label: "Mag Type", value: eventData.magType || "—" },
                { label: "Network", value: eventData.net?.toUpperCase() || "—" },
                { label: "Stations", value: eventData.nst ?? "—" },
                { label: "RMS", value: eventData.rms != null ? parseFloat(eventData.rms).toFixed(2) : "—" },
              ].map((m) => (
                <div key={m.label} className="bg-surface-card border border-border rounded-md p-2">
                  <div className="text-[10px] text-slate-500 uppercase tracking-wider">{m.label}</div>
                  <div className="text-sm font-semibold text-slate-200 mt-0.5 font-mono">{m.value}</div>
                </div>
              ))}
            </div>

            {/* Coordinates */}
            <div className="bg-surface-card border border-border rounded-md p-3">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Coordinates</div>
              <div className="text-xs text-slate-300 font-mono">
                {eventData.latitude?.toFixed(4)}° N, {eventData.longitude?.toFixed(4)}° E
              </div>
            </div>

            {/* Nearby Locations */}
            {nearbyLocs.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Affected Locations</h3>
                <div className="space-y-1">
                  {nearbyLocs.map((l) => (
                    <div key={l.id || l.label} className="flex items-center justify-between bg-surface-card border border-border rounded-md px-3 py-2">
                      <span className="text-xs text-slate-300">📍 {l.label}</span>
                      <span className="text-xs text-slate-500 font-mono">{Math.round(l.distanceKm)} km</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Revision History */}
            {revisions.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                  Revision History ({revisions.length})
                </h3>
                <div className="space-y-1.5">
                  {revisions.map((r, i) => (
                    <div key={i} className="bg-surface-card border border-border rounded-md px-3 py-2 flex items-center gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-slate-400 font-mono">{r.fieldName}</span>
                        <span className="text-xs text-slate-600 mx-1">:</span>
                        <span className="text-xs text-red-400/70 line-through">{r.oldValue}</span>
                        <span className="text-xs text-slate-600 mx-1">→</span>
                        <span className="text-xs text-green-400">{r.newValue}</span>
                      </div>
                      <span className="text-[10px] text-slate-600">{timeAgo(r.revisedAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* USGS Link */}
            {eventData.url && (
              <a
                href={eventData.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center text-xs text-blue-400 hover:text-blue-300 bg-blue-500/10 border border-blue-500/20 rounded-md py-2 transition-colors"
              >
                View on USGS →
              </a>
            )}
          </div>
        )}
      </div>
    </>
  );
}
