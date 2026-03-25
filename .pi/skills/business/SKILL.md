---
name: business
description: Business analysis and planning composite pipeline. Orchestrates research, requirements analysis, prioritization, architecture design, task creation, and cross-cutting validation. Produces artifacts in docs/ that the technical pipeline consumes asynchronously.
---

# Business Pipeline — Composite Skill

Orchestrates the full business analysis workflow. Each sub-agent reads upstream artifacts and produces its own. The technical pipeline consumes the output later, in separate runs.

## Pipeline Flow

```
Wave 1: Research (parallel)
├── product      — competitor intelligence, feature proposals
└── researcher   — idea evaluation, tech/business analysis

Wave 2: Analysis
└── business-analyst — synthesizes research into BRD & requirements
    (depends on: product, researcher)

Wave 3: Prioritization
└── product-owner — prioritizes scope, defines MVP, roadmap
    (depends on: business-analyst)

Wave 4: Design
└── architect — technical design, component boundaries, APIs
    (depends on: product-owner)

Wave 5: Planning
└── task-creator — breaks down into actionable dev tasks
    (depends on: architect)

Wave 6: Validation (parallel)
├── brd-grooming — checks BRD vs tasks consistency
└── integrator   — cross-cutting integration review
    (both depend on: task-creator)
```

## Artifacts Produced

| Sub-agent | Output |
|-----------|--------|
| product | `docs/research/competitors.md` |
| researcher | `docs/research/evaluation.md` |
| business-analyst | `docs/BRD.md`, `docs/requirements/` |
| product-owner | `docs/roadmap.md`, `docs/mvp-scope.md` |
| architect | `docs/tech-reqs/` |
| task-creator | `docs/tasks/` |
| brd-grooming | `docs/reviews/brd-grooming.md` |
| integrator | `docs/reviews/integration-review.md` |

## Boundary

- **Mode:** role — when this skill is active, you ARE the business pipeline orchestrator. Do not implement code, only produce planning artifacts.
- **Produces:** all business artifacts in `docs/` — research, BRD, requirements, roadmap, scope, tech-reqs, tasks, reviews
- **Never:** modify source code, test files, config files, or any file outside `docs/`
- **Never:** implement features — only plan and document them
- **Never:** use the `edit` or `write` tool on anything outside `docs/`
- **Allowed tools:** `read` (codebase for reference), `bash` (read-only commands), `write` (only to `docs/`)
- **Allowed write paths:** `docs/**`

## Rules

- All output goes to `docs/` directory — never modify source code
- Artifacts flow: research → requirements (BRD) → prioritized scope → architecture → tasks → validation
- Each sub-agent reads upstream artifacts and produces its own
- Final validators (brd-grooming, integrator) check consistency across all layers

## Relationship with Technical Pipeline

The business pipeline is **standalone** — it runs independently via `run_agent`.
The technical pipeline reads `docs/tasks/` and `docs/tech-reqs/` when it runs later.
No direct dependency — they are decoupled by artifacts on disk.
