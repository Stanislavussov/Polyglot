# Task 54 — Fix Core Barrel Export Conflicts

**Status:** 🔲 To Do  
**Category:** Architecture — Medium  

---

## Goal

Eliminate the fragile manual deduplication workarounds in `packages/core/src/index.ts`. Currently 2 export blocks have manual comments working around TS2308 (duplicate identifier) conflicts:

```typescript
// Line 19: Idiom analysis — GenerateObjectFn is also exported from translation, so we
// re-export everything except the duplicate to avoid TS2308.
export type { AnalyzeInput, IdiomAnalysisInput, ... } from "./modules/idiom-analysis/index.js";

// Line 39: Validation — ExpressionType is also exported from translation, so we
// re-export everything except the duplicate to avoid TS2308.
export type { ExampleInput, ValidateInput, ... } from "./modules/validation/index.js";
```

Adding any new type to idiom-analysis or validation that shares a name with translation will silently break the build. As modules grow (SRS, quiz), collision risk increases.

## Required Behavior

Either:
- **Option A:** Namespace re-exports: `export * as idiomAnalysis from "./modules/idiom-analysis/index.js"`
- **Option B:** Scoped package entry points: `@polyglot/core/translation`, `@polyglot/core/validation` (TypeScript `exports` map)
- **Option C:** Rename conflicting types at source to be globally unique (`GenerateObjectFn` → `TranslationGenerateObjectFn`, `IdiomGenerateObjectFn`)

Recommended: **Option B** — gives clean import paths and future-proofs against further collisions.

## Acceptance Criteria

- [ ] Decision documented: which approach (A, B, or C) — with rationale
- [ ] Zero `// re-export everything except the duplicate to avoid TS2308` comments in `index.ts`
- [ ] All `export *` from modules work without manual exclusions
- [ ] Consumers updated to use new import paths (if Option B) or namespaces (if Option A)
- [ ] Adding a new type to any module cannot cause a barrel conflict (verified by design, not just by luck)
- [ ] TypeScript compilation succeeds across all packages
- [ ] All existing tests pass

## Dependencies

None

## Effort Estimate

2–3 hours (choose approach: 0.5h, implement: 1h, migrate consumers: 1h, verify build: 0.5h)

## Files Likely Affected

- `packages/core/src/index.ts` — restructure re-exports
- `packages/core/package.json` — add `exports` map (if Option B)
- `packages/core/tsconfig.json` — update paths (if Option B)
- `packages/core/src/modules/idiom-analysis/types.ts` — rename types (if Option C)
- All consumer files importing conflicting types — update import paths
