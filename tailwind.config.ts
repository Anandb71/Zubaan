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
        "ink-3": "var(--ink-3)",
        bone: "var(--bone)",
        dim: "var(--dim)",
        cy: "var(--cy)",
        sf: "var(--sf)",
        red: "var(--red)",
        ind: "var(--ind)",
        paper: "var(--paper)",
        "paper-muted": "var(--paper-muted)",
        line: "var(--line)",
        signal: "var(--signal)",
        safe: "var(--safe)",
        saffron: "var(--saffron)",
      },
      fontFamily: {
        display: [
          "var(--font-bricolage)",
          "Bricolage Grotesque",
          "sans-serif",
        ],
        sans: ["var(--font-bricolage)", "Bricolage Grotesque", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "monospace"],
        mark: ["var(--font-mark)", "Silkscreen", "monospace"],
        deva: ["var(--font-deva)", "Noto Sans Devanagari", "serif"],
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
        rise: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "signal-in": "signal-in 240ms cubic-bezier(.2,.8,.2,1) both",
        "level-pulse": "level-pulse 720ms ease-in-out infinite",
        rise: "rise 400ms ease both",
      },
    },
  },
  plugins: [],
};

export default config;
