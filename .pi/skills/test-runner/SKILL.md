---
name: test-runner
description: Runs the full test suite, analyzes failures, and fixes broken tests. The final quality gate in the pipeline. Use when running tests, diagnosing test failures, or fixing broken tests after code changes.
---

# Test Runner — Quality Gate Skill

Runs the full test suite, analyzes failures, and fixes broken tests. This is the final quality gate in the pipeline.

## Skills (Public API)

- `runTests()` → run `pnpm test`, report results
- `analyzeFailures(output)` → identify root causes of failing tests
- `fixTests(failures[])` → fix test files (not source code)
- `reportSummary()` → test count, pass/fail, coverage

## Boundary

- **Mode:** role — when this skill is active, you ARE the test runner. Fix tests to match code, never fix code to match tests.
- **Produces:** passing test suite, updated test files (`**/*.test.ts`)
- **Never:** modify source code — only test files
- **Never:** skip or delete failing tests — fix them or report them
- **Never:** use the `edit` or `write` tool on non-test source files
- **Allowed tools:** `read` (source + test files), `bash` (`pnpm test`, file operations), `edit` (test files only), `write` (test files only)
- **Allowed write paths:** `**/*.test.ts`, `**/__tests__/**`

## Rules

- Run `pnpm lint` first — fix any lint/formatting errors with `pnpm lint:fix`, then verify with `pnpm lint`
- Run `pnpm test` from the project root
- If all tests pass — report success summary with test count and coverage
- If tests fail — read the failing test files AND the source files they test
- Fix only test files — never modify source code
- Common fixes: update mocks to match changed signatures, fix import paths, adjust expected values
- After fixing, re-run `pnpm test` to verify — repeat until green or max 3 attempts
- If tests still fail after 3 attempts — report the remaining failures clearly with file paths and error messages
- Never skip or delete failing tests — fix them or report them

## Workflow

```
1. pnpm lint
   ├── ✅ Clean → continue
   └── ❌ Errors → pnpm lint:fix → verify with pnpm lint
2. pnpm test
   ├── ✅ All pass → report summary
   └── ❌ Failures → analyze
        ├── Read failing test file
        ├── Read source file it tests
        ├── Fix test file
        └── Re-run (max 3 attempts)
             ├── ✅ Fixed → report
             └── ❌ Still failing → report remaining failures
```

## Reference

- Test conventions: Vitest, `<module>.test.ts` next to source
- Imports: use `.js` extensions
- Mocking: `vi.mock()`, `vi.fn()`, `vi.spyOn()`
