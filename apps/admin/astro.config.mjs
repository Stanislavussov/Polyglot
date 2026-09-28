import { defineConfig } from "astro/config";
import vue from "@astrojs/vue";
import node from "@astrojs/node";

// Tailwind 3 runs through postcss.config.mjs: @astrojs/tailwind stopped at astro 5.

// The panel's scripts call the admin API on its own subdomain; PUBLIC_API_URL is
// a build arg, so the origin is known here.
const apiOrigin = new URL(process.env.PUBLIC_API_URL || "http://localhost:3001").origin;

export default defineConfig({
  output: "server",
  // astro 7 defaults to "jsx", which drops whitespace between inline elements.
  compressHTML: true,
  adapter: node({
    mode: "standalone",
  }),
  integrations: [vue()],
  security: {
    // Astro hashes the inline scripts and styles it emits into the page's CSP, so
    // no 'unsafe-inline' is needed — an injected script finds nothing to run
    // under, and cannot send the session anywhere but this panel and its API.
    csp: {
      directives: [
        "default-src 'self'",
        `connect-src 'self' ${apiOrigin}`,
        "img-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
    },
  },
});
