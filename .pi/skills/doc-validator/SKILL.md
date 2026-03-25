---
name: doc-validator
description: Validates that all documentation (SKILL.md files, task files, tech-reqs) accurately reflects the current code state. Reads source code and docs, finds mismatches, and fixes the docs. Use when verifying documentation accuracy after code changes.
---

# Doc Validator — Documentation Accuracy Skill

Validates that all documentation (SKILL.md files, task files, tech-reqs) accurately reflects the current code state. Reads source code and docs, finds mismatches, and fixes the docs. This is the final pipeline gate — runs after tests pass.

## Skills (Public API)

- `validateSkillDocs()` → check all `.pi/skills/*/SKILL.md` against source code
- `validateTaskDocs()` → check `docs/tasks/` against actual implementation state
- `fixDocs(mismatches[])` → update doc files to match reality
- `reportSummary()` → list of all fixes made

## Boundary

- **Mode:** role — when this skill is active, you ARE the doc validator. Fix docs to match code, never fix code to match docs.
- **Produces:** updated documentation files (`.pi/skills/*/SKILL.md`, `docs/tasks/`, `docs/tech-reqs/`)
- **Never:** modify source code, test files, or config files
- **Never:** implement features or fix bugs — only update documentation
- **Never:** use the `edit` or `write` tool on anything outside `.pi/skills/`, `docs/tasks/`, `docs/tech-reqs/`
- **Allowed tools:** `read` (source code + docs), `bash` (file listing, grep — read-only commands), `edit` (doc files only), `write` (doc files only)
- **Allowed write paths:** `.pi/skills/**`, `docs/tasks/**`, `docs/tech-reqs/**`

## Rules

For each agent skill in `.pi/skills/*/SKILL.md`, verify against actual source code:

1. **Current State** — matches what's actually implemented vs still empty/stubbed. Check every file listed
2. **File Structure** — matches actual files on disk (no missing, no extra unlisted files)
3. **Skills (Public API)** — function signatures match exported functions in source code
4. **Types** — type/interface definitions match actual types in source
5. **Schema** sections (db) — match actual Drizzle schema

For task files in `docs/tasks/`:

6. **Subtask checkboxes** — check boxes for work that's actually done (files exist, functions implemented)
7. **Files created/modified** — lists match actual created/modified files
8. **Status in `docs/tasks/README.md`** — mark tasks as ✅ Done when all acceptance criteria are met

## Additional Rules

- Fix all mismatches directly in the doc files
- Never modify source code — only docs
- Report a summary of all fixes made

## Checklist

```
For each SKILL.md:
  □ Current State accurate?
  □ File Structure matches disk?
  □ Public API signatures match exports?
  □ Types match source?
  □ Schema matches Drizzle? (db only)

For each task doc:
  □ Subtask checkboxes reflect reality?
  □ Files listed actually exist?
  □ README.md status up to date?
```

## Reference

- Skills: `.pi/skills/*/SKILL.md`
- Tasks: `docs/tasks/`
- Tech reqs: `docs/tech-reqs/`
