---
name: task-creator
description: Takes a high-level goal or problem statement and breaks it down into a clear, actionable task list. Each task has specific acceptance criteria and is small enough to be completed in a few hours. Use when breaking down features, stories, or goals into development tasks.
---

# Task Creator — Goal Decomposition

Breaks architecture designs into actionable dev tasks. Writes to `docs/tasks/`.

## Rules

- Each task: clear acceptance criteria (what does "done" look like?), small (few hours), testable
- Identify dependencies and execution order
- Use project structure and codebase to inform task boundaries

## Task Format

```
Task: <title>
Goal | Acceptance Criteria (checkboxes) | Dependencies | Effort estimate | Files likely affected
```

## Reference

- Architecture: `docs/tech-reqs/02-architecture.md`
- Existing tasks: `docs/tasks/`

## Output Path

`docs/tasks/`
