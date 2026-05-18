import { format, formatDistanceToNowStrict } from "date-fns";

/** Magnitude → severity color classes */
export function magColorClass(mag) {
  if (mag >= 6) return { bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/40", dot: "bg-red-500", ring: "ring-red-500/30" };
  if (mag >= 5) return { bg: "bg-orange-500/15", text: "text-orange-400", border: "border-orange-500/40", dot: "bg-orange-500", ring: "ring-orange-500/30" };
  if (mag >= 4) return { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/40", dot: "bg-amber-500", ring: "ring-amber-500/30" };
  if (mag >= 3) return { bg: "bg-yellow-500/15", text: "text-yellow-400", border: "border-yellow-500/40", dot: "bg-yellow-500", ring: "ring-yellow-500/30" };
  return { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30", dot: "bg-blue-500", ring: "ring-blue-500/20" };
}

/** PAGER alert level → color */
export function alertColor(level) {
  const map = {
    red: { bg: "bg-red-500/20", text: "text-red-400", border: "border-red-500/40" },
    orange: { bg: "bg-orange-500/20", text: "text-orange-400", border: "border-orange-500/40" },
    yellow: { bg: "bg-yellow-500/20", text: "text-yellow-400", border: "border-yellow-500/40" },
    green: { bg: "bg-green-500/15", text: "text-green-400", border: "border-green-500/30" },
  };
  return map[level] || map.green;
}

/** Severity level → color classes */
export function severityColor(sev) {
  const map = {
    critical: { bg: "bg-red-500/15", text: "text-red-400", border: "border-red-500/40", dot: "bg-red-500" },
    warning: { bg: "bg-amber-500/15", text: "text-amber-400", border: "border-amber-500/40", dot: "bg-amber-500" },
    info: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30", dot: "bg-blue-500" },
    system: { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/30", dot: "bg-purple-500" },
  };
  return map[sev] || map.info;
}

/** Risk level → color classes */
export function riskColorClass(level) {
  const map = {
    Critical: { bg: "bg-red-500", text: "text-red-400", glow: "shadow-red-500/30", border: "border-red-500/40", bgLight: "bg-red-500/10", ring: "ring-red-500/40" },
    High: { bg: "bg-orange-500", text: "text-orange-400", glow: "shadow-orange-500/30", border: "border-orange-500/40", bgLight: "bg-orange-500/10", ring: "ring-orange-500/40" },
    Moderate: { bg: "bg-yellow-500", text: "text-yellow-400", glow: "shadow-yellow-500/30", border: "border-yellow-500/40", bgLight: "bg-yellow-500/10", ring: "ring-yellow-500/40" },
    Low: { bg: "bg-green-500", text: "text-green-400", glow: "shadow-green-500/30", border: "border-green-500/40", bgLight: "bg-green-500/10", ring: "ring-green-500/40" },
  };
  return map[level] || map.Low;
}

/** Score → risk level */
export function scoreToLevel(score) {
  if (score >= 75) return "Critical";
  if (score >= 50) return "High";
  if (score >= 25) return "Moderate";
  return "Low";
}

/** Relative time string */
export function timeAgo(epochOrDate) {
  try {
    const d = typeof epochOrDate === "number" ? new Date(epochOrDate) : new Date(epochOrDate);
    return formatDistanceToNowStrict(d, { addSuffix: true });
  } catch { return "—"; }
}

/** Format date for display */
export function formatTime(epochOrDate) {
  try {
    const d = typeof epochOrDate === "number" ? new Date(epochOrDate) : new Date(epochOrDate);
    return format(d, "MMM d, HH:mm");
  } catch { return "—"; }
}

/** Format date for table */
export function formatTimestamp(epochOrDate) {
  try {
    const d = typeof epochOrDate === "number" ? new Date(epochOrDate) : new Date(epochOrDate);
    return format(d, "MMM d, HH:mm:ss");
  } catch { return "—"; }
}

/** Significance label */
export function sigLabel(sig) {
  if (sig >= 600) return "High";
  if (sig >= 200) return "Moderate";
  return "Low";
}

/** Get event time from various shapes */
export function getEventTime(event) {
  return event.eventTime || event.event_time || event.time;
}

/** Magnitude to marker radius for map */
export function magToRadius(mag) {
  if (mag >= 7) return 16;
  if (mag >= 6) return 13;
  if (mag >= 5) return 10;
  if (mag >= 4) return 8;
  if (mag >= 3) return 6;
  return 4;
}

/** Magnitude to hex color for map markers */
export function magToColor(mag) {
  if (mag >= 6) return "#ef4444";
  if (mag >= 5) return "#f97316";
  if (mag >= 4) return "#f59e0b";
  if (mag >= 3) return "#eab308";
  return "#3b82f6";
}

/** Chat ID from localStorage */
export function getChatId() {
  let id = localStorage.getItem("quake_chat_id");
  if (!id) {
    id = String(Math.floor(100000000 + Math.random() * 900000000));
    localStorage.setItem("quake_chat_id", id);
  }
  return id;
}
