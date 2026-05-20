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
          DEFAULT: "var(--color-surface-default)",
          secondary: "var(--color-surface-secondary)",
          card: "var(--color-surface-card)",
          "card-hover": "var(--color-surface-card-hover)",
          elevated: "var(--color-surface-elevated)",
        },
        border: {
          DEFAULT: "var(--color-border-default)",
          light: "var(--color-border-light)",
        },
        slate: {
          50: "var(--color-slate-50)",
          100: "var(--color-slate-100)",
          200: "var(--color-slate-200)",
          300: "var(--color-slate-300)",
          400: "var(--color-slate-400)",
          500: "var(--color-slate-500)",
          600: "var(--color-slate-600)",
          700: "var(--color-slate-700)",
          800: "var(--color-slate-800)",
          900: "var(--color-slate-900)",
          950: "var(--color-slate-950)",
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
