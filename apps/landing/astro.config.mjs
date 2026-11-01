import { defineConfig } from "astro/config";

// Public marketing site for polyglot.monster — fully static output,
// served by nginx from `dist/` (see deploy/Dockerfile.landing).
// Tailwind 3 runs through postcss.config.mjs: @astrojs/tailwind stopped at astro 5.
export default defineConfig({
  output: "static",
  // astro 7 defaults to "jsx", which drops whitespace between inline elements.
  compressHTML: true,
  // Vite 8's default CSS target rewrites breakpoints into `(width>=640px)` range
  // queries, which Safari < 16.4 ignores; keep the Vite 6 target the site shipped with.
  vite: { build: { cssTarget: ["chrome87", "edge88", "firefox78", "safari14"] } },
});
