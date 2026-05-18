import { riskColorClass } from "../utils";

/**
 * Circular gauge visualization for a single risk score.
 * Uses SVG for a clean, animated arc.
 */
export default function RiskGauge({ label, score, icon, size = 80 }) {
  const level = score >= 75 ? "Critical" : score >= 50 ? "High" : score >= 25 ? "Moderate" : "Low";
  const colors = riskColorClass(level);

  // SVG arc math
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(score / 100, 1);
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Background circle */}
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke="#1e293b" strokeWidth="4"
          />
          {/* Progress arc */}
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            className={`${colors.text.replace("text-", "stroke-")} transition-all duration-1000 ease-out`}
            style={{
              strokeDasharray: circumference,
              strokeDashoffset,
            }}
          />
        </svg>
        {/* Center value */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-lg font-bold font-mono ${colors.text}`}>
            {Math.round(score)}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {icon && <span className="text-xs">{icon}</span>}
        <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">
          {label}
        </span>
      </div>
    </div>
  );
}
