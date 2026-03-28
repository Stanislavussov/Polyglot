---
name: brd-grooming
description: Compares a Business Requirements Document (BRD) against a task list and surfaces every contradiction, conflict, or misalignment between them. Use when validating task lists against BRD requirements.
---

# BRD Grooming — Contradiction Detector

Compares `docs/BRD.md` against `docs/tasks/` and reports contradictions. Writes to `docs/reviews/brd-grooming.md`.

## What counts as a contradiction

- Task implements what BRD forbids
- Task missing for a mandated requirement
- Task scope narrower/wider than BRD
- Task uses different business rules/values
- Task references out-of-scope feature

## Rules

- One contradiction per block — don't group unrelated conflicts
- Include: exact BRD quote, conflicting task, severity (Critical/Major/Minor), recommendation
- Flag uncertainty as `[needs PO review]`
- **Don't rewrite BRD or tasks. Don't suggest unrelated improvements.**

## Output Path

`docs/reviews/brd-grooming.md`
