import { Outlet, NavLink, useLocation, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { getUserId, logout } from "./api";
import { useHealth, useSSE, useLocations } from "./hooks/useQuakeData";
// SSE only receives critical events (M5+, PAGER orange/red, tsunami, swarm).
// All routine data is polled.
import { timeAgo } from "./utils";
import SideDrawer from "./components/layout/SideDrawer";

const NAV_ITEMS = [
  { to: "/", label: "World View", icon: "🌍" },
  { to: "/locations", label: "Locations", icon: "📍" },
  { to: "/notifications", label: "Notifications", icon: "🔔" },
  { to: "/health", label: "System Health", icon: "💚" },
];

export default function App() {
  const { health } = useHealth();
  const { locations, locationIds, loading: locationsLoading, addLocation, removeLocation, reload: reloadLocations } = useLocations();
  const { criticalEvents, riskScores, connected } = useSSE(locationIds);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("theme") || "dark";
    } catch (_) {
      return "dark";
    }
  });
  const location = useLocation();
  const userId = getUserId();

  useEffect(() => {
    try {
      if (theme === "light") {
        document.documentElement.classList.remove("dark");
        localStorage.setItem("theme", "light");
      } else {
        document.documentElement.classList.add("dark");
        localStorage.setItem("theme", "dark");
      }
    } catch (_) {}
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  if (!userId) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  const feedOk = health?.status === "healthy";
  const lastPoll = health?.lastPoll?.polledAt;

  return (
    <div className="min-h-screen bg-surface text-slate-200 font-sans flex flex-col">
      {/* ── Navbar ──────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-surface-secondary/95 backdrop-blur-md border-b border-border">
        <div className="max-w-[1920px] mx-auto px-4 flex items-center h-12 gap-1">
          {/* Brand */}
          <div className="flex items-center gap-2 mr-6 shrink-0">
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center text-xs font-black text-white">S</div>
            <span className="text-sm font-bold tracking-tight text-slate-100 hidden sm:inline">SeismicOps</span>
          </div>

          {/* Nav Tabs */}
          <nav className="flex items-center gap-0.5">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${
                    isActive
                      ? "bg-slate-700 text-slate-100 font-semibold"
                      : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/40"
                  }`
                }
              >
                <span className="text-sm">{item.icon}</span>
                <span className="hidden md:inline">{item.label}</span>
              </NavLink>
            ))}
          </nav>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Search */}
          <div className="relative hidden lg:block">
            <input
              type="text"
              placeholder="Search events..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-52 bg-surface-card border border-border rounded-md px-3 py-1 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-600 text-[10px]">⌘K</span>
          </div>

          {/* Status indicators, Theme Toggle, and Logout */}
          <div className="flex items-center gap-3 ml-3">
            <span
              className={`w-2 h-2 rounded-full ${feedOk && connected ? "bg-green-500 animate-pulse-dot" : "bg-red-500"}`}
              title={feedOk && connected ? "Active" : "Offline"}
            />

            <button
              onClick={toggleTheme}
              className="flex items-center justify-center w-7 h-7 rounded-md border border-border bg-surface text-slate-400 hover:text-slate-100 transition-colors text-xs"
              title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>

            <button 
              onClick={() => { logout(); window.location.href = "/login"; }}
              className="text-xs text-slate-400 hover:text-slate-100 transition-colors border border-border px-2.5 py-1 rounded-md bg-surface"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* ── Main Content ───────────────────────────────────── */}
      <main className="flex-1 max-w-[1920px] w-full mx-auto">
        <Outlet
          context={{
            health,
            connected,
            criticalEvents,
            riskScores,
            locations,
            locationsLoading,
            locationIds,
            addLocation,
            removeLocation,
            reloadLocations,
            selectedEvent,
            setSelectedEvent,
            searchQuery,
            theme,
          }}
        />
      </main>

      {/* ── Event Detail Drawer ────────────────────────────── */}
      <SideDrawer event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </div>
  );
}
