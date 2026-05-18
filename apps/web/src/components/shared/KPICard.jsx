export default function KPICard({ label, value, icon, color = "text-blue-400", sub, trend }) {
  return (
    <div className="bg-surface-card border border-border rounded-lg p-3 hover:border-border-light transition-colors group">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">{label}</span>
        <span className="text-sm opacity-70 group-hover:opacity-100 transition-opacity">{icon}</span>
      </div>
      <div className={`text-xl font-bold font-mono ${color} leading-none`}>
        {value ?? "—"}
        {trend && (
          <span className={`text-[10px] ml-1.5 ${trend > 0 ? "text-red-400" : "text-green-400"}`}>
            {trend > 0 ? "▲" : "▼"} {Math.abs(trend)}%
          </span>
        )}
      </div>
      {sub && <div className="text-[10px] text-slate-500 mt-1 truncate">{sub}</div>}
    </div>
  );
}
