import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";

// Public marketing site for polyglot.monster — fully static output,
// served by nginx from `dist/` (see deploy/Dockerfile.landing).
export default defineConfig({
  output: "static",
  integrations: [tailwind()],
});
