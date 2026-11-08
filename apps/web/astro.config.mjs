import { defineConfig } from "astro/config";
import vue from "@astrojs/vue";

// Tailwind 3 runs through postcss.config.mjs: @astrojs/tailwind stopped at astro 5.

export default defineConfig({
  // web-api serves the built files with @fastify/static, so there is no Node adapter.
  output: "static",
  // "always" would 404 the dev `/api` proxy before Vite forwards it; pages still link with a slash.
  trailingSlash: "ignore",
  // astro 7 defaults to "jsx", which drops whitespace between inline elements.
  compressHTML: true,
  integrations: [vue()],
  vite: {
    server: {
      // In production the API shares the origin; in dev web-api listens on its own port.
      proxy: { "/api": "http://localhost:3002" },
    },
  },
});
