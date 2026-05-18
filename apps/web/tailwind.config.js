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
          DEFAULT: "#0a0e17",
          secondary: "#111827",
          card: "#1a2332",
          "card-hover": "#1f2b3d",
        },
        border: {
          DEFAULT: "#2a3548",
        },
      },
      animation: {
        "pulse-dot": "pulseDot 2s ease-in-out infinite",
        "slide-in": "slideIn 0.4s ease-out",
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
      },
    },
  },
  plugins: [],
};
