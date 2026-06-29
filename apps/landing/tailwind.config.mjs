/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      colors: {
        paper: "#EDE3CE",
        cream: "#FBF6EC",
        ink: {
          DEFAULT: "#231D16",
          soft: "#5C5347",
          faint: "#8A7F6F",
        },
        teal: {
          DEFAULT: "#2E9E86",
          deep: "#1F8A74",
        },
        coral: {
          DEFAULT: "#F26B4E",
          deep: "#E2583B",
        },
        gold: "#E0A33A",
        sky: "#6FA8D6",
      },
      fontFamily: {
        display: ["'Bricolage Grotesque'", "system-ui", "sans-serif"],
        sans: ["'Hanken Grotesk'", "system-ui", "sans-serif"],
      },
      keyframes: {
        f1: {
          "0%,100%": { transform: "rotate(5deg) translateY(0)" },
          "50%": { transform: "rotate(5deg) translateY(-10px)" },
        },
        f2: {
          "0%,100%": { transform: "rotate(-4deg) translateY(0)" },
          "50%": { transform: "rotate(-4deg) translateY(-7px)" },
        },
        f3: {
          "0%,100%": { transform: "rotate(6deg) translateY(0)" },
          "50%": { transform: "rotate(6deg) translateY(-12px)" },
        },
        bob: {
          "0%,100%": { transform: "translateY(0) rotate(-2deg)" },
          "50%": { transform: "translateY(-9px) rotate(-2deg)" },
        },
      },
      animation: {
        f1: "f1 6.5s ease-in-out infinite",
        f2: "f2 7.2s ease-in-out infinite 0.4s",
        f3: "f3 6.8s ease-in-out infinite 0.8s",
        bob: "bob 5.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
