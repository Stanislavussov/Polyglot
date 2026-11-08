import type { Config } from "tailwindcss";

// Every colour is a CSS variable from src/styles/tokens.css, so a palette swap never touches this file.
const config: Config = {
  content: ["./src/**/*.{astro,html,js,ts,vue}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--color-canvas)",
        surface: { DEFAULT: "var(--color-surface)", muted: "var(--color-surface-muted)" },
        line: "var(--color-line)",
        ink: { DEFAULT: "var(--color-ink)", muted: "var(--color-ink-muted)" },
        primary: {
          DEFAULT: "var(--color-primary)",
          hover: "var(--color-primary-hover)",
          fg: "var(--color-primary-fg)",
          soft: "var(--color-primary-soft)",
          "soft-fg": "var(--color-primary-soft-fg)",
        },
        danger: { DEFAULT: "var(--color-danger)", soft: "var(--color-danger-soft)" },
        warning: { soft: "var(--color-warning-soft)", fg: "var(--color-warning-fg)" },
        ring: "var(--color-ring)",
        sidebar: {
          DEFAULT: "var(--color-sidebar)",
          fg: "var(--color-sidebar-fg)",
          muted: "var(--color-sidebar-muted)",
          hover: "var(--color-sidebar-hover)",
          active: "var(--color-sidebar-active)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
      },
    },
  },
  plugins: [],
};

export default config;
