import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["./packages/core/src/test-setup.ts"],
    // Exclude agent-local worktrees/scratch (e.g. .claude/worktrees/*) from test collection.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
    coverage: {
      provider: "v8",
    },
  },
});
