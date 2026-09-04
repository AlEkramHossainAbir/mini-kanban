import type { Config } from "tailwindcss";

/**
 * Filing Room — DESIGN §2's Tailwind mapping, exact.
 *
 * Colours point at the CSS custom properties in globals.css rather than
 * duplicating hex values, so there is exactly one place a token is defined.
 */
const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        wood: { DEFAULT: "var(--wood)", hi: "var(--wood-hi)", lo: "var(--wood-lo)" },
        manila: { DEFAULT: "var(--manila)", "2": "var(--manila-2)", ink: "var(--manila-ink)" },
        card: { DEFAULT: "var(--card)", "2": "var(--card-2)", edge: "var(--edge)" },
        ink: "var(--ink)",
        pencil: "var(--pencil)",
        faint: "var(--faint)",
        rule: "var(--rule)",
        blue: "var(--blue)",
        moss: "var(--moss)",
        amber: "var(--amber)",
        hair: "var(--hair)",
      },
      borderRadius: { card: "3px", tray: "0 8px 6px 6px", tab: "7px 12px 0 0" },
      boxShadow: {
        card: "0 1px 0 rgba(255,255,255,.8) inset, 0 3px 6px -3px rgba(20,14,8,.5)",
        lift: "0 28px 46px -18px rgba(18,12,6,.66), 0 7px 15px -6px rgba(18,12,6,.45)",
        tray: "0 12px 26px -18px rgba(0,0,0,.7)",
        toast: "0 18px 34px -14px rgba(8,5,3,.7)",
      },
      transitionTimingFunction: {
        paper: "cubic-bezier(.22,.85,.28,1)",
        settle: "cubic-bezier(.16,1.24,.4,1)",
      },
      fontFamily: {
        // DESIGN §3 — exactly two families, wired from next/font in layout.tsx.
        archivo: ["var(--font-archivo)", "system-ui", "sans-serif"],
        courier: ["var(--font-courier)", "ui-monospace", "monospace"],
      },
      // DESIGN §5's motion table, so durations are named rather than guessed.
      transitionDuration: {
        hover: "200ms",
        reflow: "280ms",
        settle: "340ms",
      },
    },
  },
  plugins: [],
};
export default config;
