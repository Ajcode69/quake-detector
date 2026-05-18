import { severityColor } from "../../utils";

export default function SeverityBadge({ severity, label }) {
  const c = severityColor(severity);
  return (
    <span className={`ops-badge ${c.bg} ${c.text} border ${c.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {label || severity}
    </span>
  );
}
