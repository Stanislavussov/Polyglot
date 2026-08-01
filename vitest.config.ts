import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ["./packages/core/src/test-setup.ts"],
    // Exclude agent-local worktrees/scratch (e.g. .claude/worktrees/*) from test collection,
    // and the real-DB integration lane (Task 71) so `pnpm test` stays fast and mock-only.
    exclude: [...configDefaults.exclude, "**/.claude/**", "**/*.integration.test.ts"],
    coverage: {
      provider: "v8",
    },
  },
});
