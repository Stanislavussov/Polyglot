import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["./packages/core/src/test-setup.ts"],
    coverage: {
      provider: "v8",
    },
  },
});
