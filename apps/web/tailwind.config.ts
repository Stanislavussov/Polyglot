import type { Config } from "tailwindcss";

// Every colour is a CSS variable from src/styles/tokens.css, so a palette swap never touches this file.
const config: Config = {
  content: ["./src/**/*.{astro,html,js,ts,vue}"],
  theme: {
    extend: {
      // The whole type scale: 15 captions, 17 body, 20 titles, 24/30 display. xs and lg are deliberately unused.
      fontSize: {
        sm: ["0.9375rem", { lineHeight: "1.375rem" }],
        base: ["1.0625rem", { lineHeight: "1.625rem" }],
      },
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
        accent: { DEFAULT: "var(--color-accent)", fg: "var(--color-accent-fg)" },
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
        display: ["var(--font-display)"],
      },
      boxShadow: {
        card: "var(--shadow-card)",
        soft: "var(--shadow-soft)",
        primary: "var(--shadow-primary)",
      },
    },
  },
  plugins: [],
};

export default config;
