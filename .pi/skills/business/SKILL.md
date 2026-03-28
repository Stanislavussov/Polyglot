---
name: business
description: Business analysis and planning composite pipeline. Orchestrates research, requirements analysis, prioritization, architecture design, task creation, and cross-cutting validation. Produces artifacts in docs/ that the technical pipeline consumes asynchronously.
---

# Business Pipeline — Composite Skill

Orchestrates business analysis. Each sub-agent reads upstream artifacts and writes its own to `docs/`.

## Pipeline Flow

```
Wave 1 (parallel): product + researcher
Wave 2: business-analyst → Wave 3: product-owner → Wave 4: architect → Wave 5: task-creator
Wave 6 (parallel): brd-grooming + integrator
```

## Artifacts

| Agent | Output |
|-------|--------|
| product | `docs/research/competitors.md` |
| researcher | `docs/research/evaluation.md` |
| business-analyst | `docs/BRD.md`, `docs/requirements/` |
| product-owner | `docs/roadmap.md`, `docs/mvp-scope.md` |
| architect | `docs/tech-reqs/` |
| task-creator | `docs/tasks/` |
| brd-grooming | `docs/reviews/brd-grooming.md` |
| integrator | `docs/reviews/integration-review.md` |

## Constraints

- **Write only to `docs/`** — never touch source code, tests, or configs
- Artifacts flow: research → BRD → scope → architecture → tasks → validation
- Technical pipeline reads `docs/tasks/` and `docs/tech-reqs/` later — no direct coupling
