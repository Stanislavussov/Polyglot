# Task 22: Module Dependency Direction Validation with dependency-cruiser

**Status:** 🔲 To Do

---

## Goal

Install and configure [`dependency-cruiser`](https://github.com/sverweij/dependency-cruiser) at the monorepo root to:

1. **Document** the canonical dependency direction for all packages and internal modules.
2. **Enforce** that direction via static analysis — forbidden imports fail with a clear error message.
3. **Detect and block** circular imports.
4. **Surface any existing violations** and fix them as part of this task.
5. **Wire** the check into the root `package.json` scripts so it can be run locally and in CI.

---

## Problem Statement

The architecture defines a strict three-layer model:

```
packages/core  →  no @polyglot/* dependencies
packages/adapters/*  →  only imports from @polyglot/core and @polyglot/infra
packages/infra  →  only imports from @polyglot/core and @polyglot/adapter-db
apps/bot  →  may import from any @polyglot/* package
```

Within `packages/core`, the modules also have an intended dependency direction:

```
i18n / language-detect / idiom-analysis / topics   (leaf — no cross-module deps)
validation   →  i18n (for language resolution)
translation  →  validation
context-enrichment  →  translation
```

Currently **nothing enforces these rules**. Any developer can accidentally import in the wrong direction (e.g., `core` importing from an adapter, or `adapter-db` importing from `adapter-ai`) without any immediate feedback. Circular imports are equally invisible.

---

## Canonical Dependency Map

Use the following as the ground truth for rule authoring.

### Package-level (workspace packages)

| From | May import | Must NOT import |
|---|---|---|
| `@polyglot/core` | _(no @polyglot/* at all)_ | all other `@polyglot/*` |
| `@polyglot/adapter-db` | `@polyglot/core` | `@polyglot/infra`, `@polyglot/adapter-ai`, `@polyglot/adapter-notifications`, `@polyglot/bot` |
| `@polyglot/infra` | `@polyglot/core`, `@polyglot/adapter-db` | `@polyglot/adapter-ai`, `@polyglot/adapter-notifications`, `@polyglot/bot` |
| `@polyglot/adapter-ai` | `@polyglot/core`, `@polyglot/infra` | `@polyglot/adapter-db`, `@polyglot/adapter-notifications`, `@polyglot/bot` |
| `@polyglot/adapter-notifications` | `@polyglot/core`, `@polyglot/infra` | `@polyglot/adapter-ai`, `@polyglot/adapter-db`, `@polyglot/bot` |
| `@polyglot/bot` | all `@polyglot/*` | _(no package-level restriction)_ |

### Internal modules within `packages/core/src/modules/`

| Module | May import (within modules/) | Must NOT import |
|---|---|---|
| `i18n` | _(nothing from other modules)_ | `translation`, `validation`, `topics`, `context-enrichment`, `idiom-analysis`, `language-detect` |
| `language-detect` | _(nothing from other modules)_ | `translation`, `validation`, `topics`, `context-enrichment`, `idiom-analysis`, `i18n` |
| `idiom-analysis` | _(nothing from other modules)_ | `translation`, `validation`, `topics`, `context-enrichment`, `i18n`, `language-detect` |
| `topics` | _(nothing from other modules)_ | `translation`, `validation`, `context-enrichment`, `idiom-analysis`, `i18n`, `language-detect` |
| `validation` | `i18n` | `translation`, `topics`, `context-enrichment`, `idiom-analysis`, `language-detect` |
| `translation` | `validation` | `topics`, `context-enrichment`, `idiom-analysis`, `language-detect` |
| `context-enrichment` | `translation` | `validation`, `topics`, `idiom-analysis`, `i18n`, `language-detect` |

---

## Subtasks

---

### Step 1 — Audit Current Dependency Graph

**Before writing any rules**, run a manual audit to understand the actual current state.

**Actions:**
- Scan all `import` / `from` statements across `packages/` and `apps/` (excluding `dist/`, `node_modules/`).
- List every cross-package `@polyglot/*` import, grouped by source package.
- List every cross-module import within `packages/core/src/modules/`, grouped by source module.
- Note any import that violates the canonical map above.

**Deliverable:** A short written summary (can live as a comment block at the top of the `.dependency-cruiser.cjs` file) that states:
- "N violations found, listed below" — or "No violations found."
- Each violation listed as: `FROM → TO` with the file path.

**Acceptance criteria:**
- All current imports are documented.
- Violations are identified (even if not yet fixed — fixing happens in Step 6).

---

### Step 2 — Install dependency-cruiser

**File:** `package.json` (root)

Install `dependency-cruiser` as a root `devDependency`:

```bash
pnpm add -D dependency-cruiser --workspace-root
```

**Acceptance criteria:**
- `dependency-cruiser` appears in root `package.json` `devDependencies`.
- `node_modules/.bin/depcruise` is available after install.
- Running `pnpm exec depcruise --version` from the root prints a version string.

---

### Step 3 — Create `.dependency-cruiser.cjs` Configuration

**File:** `.dependency-cruiser.cjs` (monorepo root)

Create the dependency-cruiser configuration. Use **CommonJS** format (`.cjs`) since the root package is `"type": "module"` and dependency-cruiser's config is loaded as CommonJS.

The config must use **TypeScript path resolution** (`tsConfig` option pointing to the root `tsconfig.json`).

#### 3a — Forbidden rules (package-level)

Define one `forbidden` rule per violation direction:

| Rule name | What it catches |
|---|---|
| `no-core-importing-polyglot` | `@polyglot/core` imports any `@polyglot/*` package |
| `no-adapter-db-importing-infra` | `@polyglot/adapter-db` imports `@polyglot/infra` |
| `no-adapter-db-importing-ai-or-notifications` | `@polyglot/adapter-db` imports `@polyglot/adapter-ai` or `@polyglot/adapter-notifications` |
| `no-infra-importing-adapters-ai-or-notifications` | `@polyglot/infra` imports `@polyglot/adapter-ai` or `@polyglot/adapter-notifications` |
| `no-adapter-ai-importing-db-or-notifications` | `@polyglot/adapter-ai` imports `@polyglot/adapter-db` or `@polyglot/adapter-notifications` |
| `no-adapter-notifications-importing-ai-or-db` | `@polyglot/adapter-notifications` imports `@polyglot/adapter-ai` or `@polyglot/adapter-db` |
| `no-circular` | Any circular dependency anywhere in the codebase |

#### 3b — Forbidden rules (core-internal modules)

Define rules to enforce the internal module hierarchy inside `packages/core/src/modules/`:

| Rule name | What it catches |
|---|---|
| `no-i18n-importing-other-modules` | `i18n` imports from any sibling module |
| `no-language-detect-importing-other-modules` | `language-detect` imports from any sibling module |
| `no-idiom-analysis-importing-other-modules` | `idiom-analysis` imports from any sibling module |
| `no-topics-importing-other-modules` | `topics` imports from any sibling module |
| `no-validation-importing-translation-or-higher` | `validation` imports from `translation`, `topics`, `context-enrichment`, `idiom-analysis`, `language-detect` |
| `no-translation-importing-context-or-higher` | `translation` imports from `context-enrichment` (it may import `validation`) |
| `no-context-enrichment-importing-unsupported` | `context-enrichment` imports from anything other than `translation` |

#### 3c — `options` block

```js
options: {
  doNotFollow: {
    path: ["node_modules", "dist", "\\.test\\.ts$", "\\.spec\\.ts$"],
  },
  tsConfig: {
    fileName: "tsconfig.json",
  },
  moduleSystems: ["es6", "cjs"],
  outputType: "err",
  reporterOptions: {
    err: {
      showRuleViolations: true,
    },
  },
}
```

**Acceptance criteria:**
- `.dependency-cruiser.cjs` exists at the monorepo root.
- All 13+ forbidden rules are present (7 package-level + 6+ core-internal).
- `no-circular` rule is present.
- Running `pnpm exec depcruise --config .dependency-cruiser.cjs packages apps` does not crash (may report violations — that is expected until Step 6).
- The config file is valid JS (no syntax errors).

---

### Step 4 — Add Scripts to `package.json`

**File:** `package.json` (root)

Add two scripts:

```json
"scripts": {
  "lint:deps": "depcruise --config .dependency-cruiser.cjs packages apps/bot/src",
  "lint:deps:graph": "depcruise --config .dependency-cruiser.cjs --output-type dot packages apps/bot/src | dot -T svg > docs/dependency-graph.svg"
}
```

> `lint:deps:graph` is optional (requires `graphviz` installed locally) but is useful for visualising the module graph. It is not required for CI.

**Acceptance criteria:**
- `pnpm lint:deps` runs dependency-cruiser against all source (excluding `dist/`, `node_modules/`).
- Exit code is `0` when no violations are present, non-zero when violations are found.
- The script is documented in the root `README.md` (or a comment in `package.json`) so developers know it exists.

---

### Step 5 — Verify Rules Catch Known Violations (Dry Run)

Before fixing violations, verify the rules actually detect them.

**Actions:**
- Run `pnpm lint:deps` and observe the output.
- For each rule, write a one-line note in the `.dependency-cruiser.cjs` comment header: "Rule X: catches Y violations".
- If a rule catches 0 violations AND there is no known import it should catch — that is fine (architecture was already clean for that direction).
- If a rule catches 0 violations but there IS a known violation — the rule is incorrect and must be fixed.

**Acceptance criteria:**
- Every rule that _should_ catch a violation in the current codebase does in fact produce an error.
- No false positives (e.g., a rule firing on `__tests__` files that have legitimate cross-module mocking patterns — use `doNotFollow` or `path` patterns to exclude test files from applicable rules if needed).

---

### Step 6 — Fix All Detected Violations

For every violation reported by `pnpm lint:deps`, fix the source code or restructure the import so the violation is resolved.

**Common violation patterns and their fixes:**

| Violation | Likely Fix |
|---|---|
| `core` imports from an adapter | Extract the needed type/interface into `core/shared/` or pass it via dependency injection |
| Adapter imports another adapter | Pass the needed functionality via constructor injection or interface, not a direct import |
| Circular import within a module | Break the cycle by extracting shared types to a `types.ts` file that both sides import from |
| `validation` importing from `translation` | Move shared types to `shared/` or reverse the dependency (translation calls validation, not vice versa) |

**Acceptance criteria:**
- `pnpm lint:deps` exits with code `0`.
- All forbidden rule violations are eliminated.
- `pnpm test` still passes (`vitest run`) — no regressions.
- `pnpm -r run build` still passes — TypeScript compiles cleanly.

---

### Step 7 — (Optional) Generate & Commit Dependency Graph SVG

**File:** `docs/dependency-graph.svg`

If `graphviz` is available:

```bash
pnpm lint:deps:graph
```

Commit the generated SVG as a visual reference for the canonical module dependency map.

**Acceptance criteria:**
- `docs/dependency-graph.svg` exists and renders a correct directed acyclic graph.
- The graph matches the canonical dependency map in this document.

---

### Step 8 — Add `deps-validator` Agent to `.pi/settings.json`

**File:** `.pi/settings.json`

Add a new orchestrator agent named `deps-validator` that runs `pnpm lint:deps` as a pipeline gate. It must be placed **before** the `test-runner` agent and **after** all code-producing agents.

#### 8a — Define the agent

Add the following agent definition to the `orchestrator.agents` array, inserted immediately before the `test-runner` entry:

```json
{
  "name": "deps-validator",
  "role": "Runs dependency-cruiser to validate module import direction. Ensures no circular or forbidden imports exist across the codebase. This is a pre-test quality gate in the pipeline.",
  "rules": "Run `pnpm lint:deps` from the project root.\nIf exit code is 0 — report success with a summary of packages/modules checked.\nIf exit code is non-zero — read the violation output carefully.\nFor each violation: identify the source file, the forbidden import, and which rule it breaks.\nAttempt to fix violations by restructuring imports (extract shared types, use dependency injection, break cycles).\nAfter fixing, re-run `pnpm lint:deps` to verify — repeat until clean or max 3 attempts.\nIf violations remain after 3 attempts — report them clearly with file paths, rule names, and suggested fixes.\nNever disable or weaken dependency-cruiser rules — fix the code, not the config.",
  "type": "coding",
  "dependsOn": [
    "bot",
    "notifications",
    "topics",
    "translation",
    "ai",
    "validation",
    "db",
    "i18n"
  ]
}
```

#### 8b — Update `test-runner` dependencies

Add `deps-validator` to the `test-runner` agent's `dependsOn` array so it runs after deps are validated:

```json
{
  "name": "test-runner",
  "dependsOn": [
    "deps-validator",
    "bot",
    "notifications",
    "topics",
    "translation",
    "ai",
    "validation",
    "db",
    "i18n"
  ]
}
```

#### Pipeline order (relevant portion)

```
[all code agents] → deps-validator → test-runner → doc-validator
```

**Acceptance criteria:**
- `deps-validator` agent exists in `.pi/settings.json` orchestrator config.
- `deps-validator` appears before `test-runner` in the agents array.
- `test-runner.dependsOn` includes `deps-validator`.
- Running the full orchestration pipeline executes dependency validation before tests.
- The agent correctly reports violations and attempts to fix them.

---

## Files to Create

| File | Purpose |
|---|---|
| `.dependency-cruiser.cjs` | dependency-cruiser rule configuration |
| `docs/dependency-graph.svg` | (optional) visual graph of module dependencies |

## Files to Modify

| File | Change |
|---|---|
| `package.json` (root) | Add `dependency-cruiser` devDependency + `lint:deps` / `lint:deps:graph` scripts |
| `.pi/settings.json` | Add `deps-validator` agent before `test-runner`; add `deps-validator` to `test-runner.dependsOn` |
| Source files with violations | Fix imports to comply with the canonical dependency map |

---

## Acceptance Criteria (Summary)

- [ ] `dependency-cruiser` is installed as a root devDependency
- [ ] `.dependency-cruiser.cjs` exists with all forbidden rules (≥13 rules + `no-circular`)
- [ ] `pnpm lint:deps` runs and exits with code `0` (all violations fixed)
- [ ] `pnpm lint:deps` exits with a **non-zero code** if a forbidden import is introduced (verified by adding a test import and reverting)
- [ ] `no-circular` rule fires on a manually introduced cycle and is then reverted
- [ ] `pnpm test` passes with zero regressions after violation fixes
- [ ] `pnpm -r run build` passes with zero TypeScript errors after violation fixes
- [ ] `lint:deps` script is present in root `package.json`
- [ ] `deps-validator` agent is defined in `.pi/settings.json` before `test-runner`
- [ ] `test-runner.dependsOn` includes `deps-validator`
- [ ] Full orchestration pipeline runs dependency validation before tests

---

## References

- Architecture: `docs/tech-reqs/02-architecture.md`
- Adapter contract: `docs/tech-reqs/04-adapter-contract.md`
- dependency-cruiser docs: https://github.com/sverweij/dependency-cruiser
- dependency-cruiser rule format: https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md

---

## Notes for Implementors

- Use `path` patterns with regex to scope each rule to the correct package directory. Example: `"^packages/core"` for the `core` package source.
- Workspace package names (`@polyglot/core`, etc.) appear as `dependsOn` module paths in dependency-cruiser when using `tsConfig` resolver — match them using the `"module"` field in rule conditions.
- `__tests__` files and `.test.ts` / `.spec.ts` files may legitimately import across layers for mocking. Add `doNotFollow` or per-rule `path` exceptions to avoid noisy false positives from test files if needed.
- The `no-circular` rule should apply to **all** source files, not just a specific package.
- Run `pnpm exec depcruise --init` as a starting point to auto-generate a skeleton config, then customize it per this document.
