/**
 * Magnitude → color class mapping.
 * Product judgment: colors match seismological severity scales.
 */
export function magColorClass(mag) {
  if (mag >= 6) return { bg: "bg-red-500/10", text: "text-red-400", border: "border-red-500/30" };
  if (mag >= 5) return { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/30" };
  if (mag >= 3) return { bg: "bg-yellow-500/10", text: "text-yellow-400", border: "border-yellow-500/30" };
  return { bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/30" };
}

/**
 * Format epoch ms to relative time string.
 */
export function timeAgo(epochMs) {
  const seconds = Math.floor((Date.now() - epochMs) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Format epoch ms to readable date/time.
 */
export function formatTime(epochMs) {
  return new Date(epochMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Significance → label.
 */
export function sigLabel(sig) {
  if (sig >= 600) return "High";
  if (sig >= 200) return "Moderate";
  return "Low";
}

/**
 * Risk level → color classes.
 */
export function riskColorClass(level) {
  switch (level) {
    case "Critical": return { bg: "bg-red-500", text: "text-red-400", glow: "shadow-red-500/30", border: "border-red-500/40", bgLight: "bg-red-500/10" };
    case "High": return { bg: "bg-orange-500", text: "text-orange-400", glow: "shadow-orange-500/30", border: "border-orange-500/40", bgLight: "bg-orange-500/10" };
    case "Moderate": return { bg: "bg-yellow-500", text: "text-yellow-400", glow: "shadow-yellow-500/30", border: "border-yellow-500/40", bgLight: "bg-yellow-500/10" };
    default: return { bg: "bg-green-500", text: "text-green-400", glow: "shadow-green-500/30", border: "border-green-500/40", bgLight: "bg-green-500/10" };
  }
}

/**
 * Score → risk level string.
 */
export function scoreToLevel(score) {
  if (score >= 75) return "Critical";
  if (score >= 50) return "High";
  if (score >= 25) return "Moderate";
  return "Low";
}
