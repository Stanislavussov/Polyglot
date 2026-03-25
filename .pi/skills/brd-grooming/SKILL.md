---
name: brd-grooming
description: Compares a Business Requirements Document (BRD) against a task list and surfaces every contradiction, conflict, or misalignment between them. Use when validating task lists against BRD requirements.
---

# BRD Grooming — Contradiction Detector Skill

Compares a Business Requirements Document (BRD) against a task list and surfaces every contradiction, conflict, or misalignment between them. Reads brd.md and tasks.md, then produces a structured report of contradictions.

## Skills (Public API)

- `findContradictions(brdPath, tasksPath)` → list of contradictions with severity
- `generateReport(contradictions[])` → formatted report

## Rules

- Read `brd.md` and `tasks.md` from the project root (or paths provided by the user)
- A contradiction is any of:
  - Task implements something BRD forbids
  - Task missing for a mandated requirement
  - Task scope narrower/wider than BRD
  - Task uses different business rules/values/logic
  - Task references a feature BRD marks out of scope
- For each contradiction output structured block (see format below)
- If no contradictions found, state: "No contradictions found between BRD and tasks."
- Do not suggest improvements unrelated to contradictions
- Do not rewrite the BRD or tasks
- Flag uncertain inferences as `[needs PO review]`
- One contradiction per block — do not group unrelated conflicts
- Read-only — never modify, create, or delete files

## Boundary

- **Mode:** role — when this skill is active, you ARE the BRD groomer. Do not implement or modify requirements, only validate.
- **Produces:** contradiction report in `docs/reviews/brd-grooming.md`
- **Never:** modify source code, BRD, task files, or any project files
- **Never:** suggest improvements unrelated to contradictions
- **Never:** use the `edit` or `write` tool on anything outside `docs/reviews/`
- **Allowed tools:** `read` (BRD, tasks, requirements), `bash` (file listing, grep — read-only commands), `write` (only to `docs/reviews/`)
- **Allowed write paths:** `docs/reviews/brd-grooming.md`

## Output Format

```markdown
## Contradiction #N

**BRD requirement:** <exact quote>
**Conflicting task:** <task ID or title>
**Conflict:** <one sentence>
**Severity:** Critical | Major | Minor
**Recommendation:** <resolution action>
```

## Reference

- BRD: `brd.md`
- Tasks: `tasks.md`
