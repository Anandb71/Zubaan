import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "var(--ink)",
        "ink-soft": "var(--ink-soft)",
        paper: "var(--paper)",
        "paper-muted": "var(--paper-muted)",
        line: "var(--line)",
        signal: "var(--signal)",
        safe: "var(--safe)",
        saffron: "var(--saffron)",
      },
      fontFamily: {
        display: ["Bahnschrift", "Aptos Display", "Nirmala UI", "sans-serif"],
        sans: ["Aptos", "Nirmala UI", "Segoe UI", "sans-serif"],
      },
      keyframes: {
        "signal-in": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "level-pulse": {
          "0%, 100%": { transform: "scaleY(.25)", opacity: ".45" },
          "50%": { transform: "scaleY(1)", opacity: "1" },
        },
      },
      animation: {
        "signal-in": "signal-in 240ms cubic-bezier(.2,.8,.2,1) both",
        "level-pulse": "level-pulse 720ms ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
