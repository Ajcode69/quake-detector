import { magColorClass, timeAgo } from "../utils";

export default function EventCard({ event, isNew }) {
  const mag = parseFloat(event.mag) || 0;
  const colors = magColorClass(mag);
  const time = event.time || event.event_time;

  return (
    <a
      href={event.url || `https://earthquake.usgs.gov/earthquakes/eventpage/${event.id}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`
        group grid grid-cols-[56px_1fr_auto] items-center gap-4 p-4
        bg-surface-card border border-border rounded-xl
        hover:bg-surface-card-hover hover:border-blue-500/40
        hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/30
        transition-all duration-200 cursor-pointer
        ${isNew ? "animate-slide-in border-l-[3px] border-l-blue-500" : ""}
      `}
    >
      {/* Magnitude badge */}
      <div
        className={`
          flex items-center justify-center w-[52px] h-[52px]
          rounded-lg font-mono font-bold text-lg
          ${colors.bg} ${colors.text} border ${colors.border}
        `}
      >
        {mag.toFixed(1)}
      </div>

      {/* Event info */}
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-slate-100 truncate group-hover:text-blue-400 transition-colors">
          {event.place || "Unknown location"}
        </h3>
        <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 flex-wrap">
          <span>📏 {event.depth != null ? `${parseFloat(event.depth).toFixed(1)}km` : "—"}</span>
          <span>📊 sig {event.sig ?? "—"}</span>
          {event.status === "reviewed" && (
            <span className="px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 text-[10px] font-semibold uppercase">
              Reviewed
            </span>
          )}
          {event.tsunami === 1 && (
            <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 text-[10px] font-semibold uppercase">
              🌊 Tsunami
            </span>
          )}
          {event.alert && (
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                event.alert === "red"
                  ? "bg-red-500/20 text-red-400"
                  : event.alert === "orange"
                  ? "bg-orange-500/20 text-orange-400"
                  : event.alert === "yellow"
                  ? "bg-yellow-500/20 text-yellow-400"
                  : "bg-green-500/20 text-green-400"
              }`}
            >
              PAGER: {event.alert}
            </span>
          )}
        </div>
      </div>

      {/* Right meta */}
      <div className="text-right hidden sm:block">
        <div className="font-mono text-xs font-semibold text-slate-400">
          {event.net?.toUpperCase()}
        </div>
        <div className="text-[11px] text-slate-500 mt-0.5">
          {time ? timeAgo(typeof time === "string" ? new Date(time).getTime() : time) : "—"}
        </div>
      </div>
    </a>
  );
}
