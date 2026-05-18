/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        surface: {
          DEFAULT: "#080b12",
          secondary: "#0d1117",
          card: "#111827",
          "card-hover": "#1a2332",
          elevated: "#1e293b",
        },
        border: {
          DEFAULT: "#1e293b",
          light: "#2a3548",
        },
        severity: {
          critical: "#ef4444",
          warning: "#f59e0b",
          moderate: "#f97316",
          info: "#3b82f6",
          ok: "#22c55e",
        },
      },
      animation: {
        "pulse-dot": "pulseDot 2s ease-in-out infinite",
        "slide-in": "slideIn 0.4s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
        "fade-in": "fadeIn 0.4s ease-out",
      },
      keyframes: {
        pulseDot: {
          "0%, 100%": { opacity: 1, boxShadow: "0 0 0 0 rgba(34,197,94,0.4)" },
          "50%": { opacity: 0.7, boxShadow: "0 0 0 6px rgba(34,197,94,0)" },
        },
        slideIn: {
          from: { opacity: 0, transform: "translateX(-10px)" },
          to: { opacity: 1, transform: "translateX(0)" },
        },
        slideUp: {
          from: { opacity: 0, transform: "translateY(8px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
        fadeIn: {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
      },
    },
  },
  plugins: [],
};
