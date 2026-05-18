export default function StatCard({ label, value, color = "text-slate-100", icon }) {
  return (
    <div className="bg-surface-card border border-border rounded-xl p-5 hover:border-blue-500/30 hover:shadow-lg hover:shadow-blue-500/5 transition-all duration-200">
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1.5">
        {icon && <span className="mr-1">{icon}</span>}
        {label}
      </div>
      <div className={`text-3xl font-bold font-mono ${color}`}>{value}</div>
    </div>
  );
}
