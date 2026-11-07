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
      // In production the API shares the origin; in dev web-api listens on its own port,
      // which a parallel worktree may already hold — hence the same env var web-api reads.
      proxy: { "/api": `http://localhost:${process.env.WEB_API_PORT ?? "3002"}` },
    },
  },
});
