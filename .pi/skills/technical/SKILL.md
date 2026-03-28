---
name: technical
description: Technical implementation composite pipeline. Implements tasks from docs/tasks/ across all layers — i18n, validation, DB, AI, translation, topics, notifications, bot. Includes quality gates (test-runner, doc-validator).
---

# Technical Pipeline — Composite Skill

Implements tasks produced by the business pipeline. Reads task specs from `docs/tasks/` and `docs/tech-reqs/`, then runs agents in dependency order across all architecture layers.

## Pipeline Flow

```
Wave 1: Foundation
└── i18n — internationalization (leaf, no deps)

Wave 2: Core checks
└── validation — AI response quality checks
    (depends on: i18n)

Wave 3: Adapters (parallel)
├── db — database layer (Drizzle + PostgreSQL)
│   (depends on: validation, i18n)
└── ai — AI adapter (OpenRouter + Vercel AI SDK)
    (depends on: validation)

Wave 4: Domain
└── translation — word/phrase translation via AI
    (depends on: ai, validation)

Wave 5: Features
└── topics — topic management + dataset caching
    (depends on: translation, db)

Wave 6: Infrastructure
└── notifications — scheduling + delivery
    (depends on: db, topics)

Wave 7: Application
└── bot — Telegram bot (grammY)
    (depends on: i18n, db, translation, topics, notifications)

── Each implementation agent (Waves 1–N) runs `pnpm lint` after finishing its changes ──

Wave 8: Quality gate
└── test-runner — run lint + tests, fix failures
    (depends on: all implementation agents)

Wave 9: Documentation gate
└── doc-validator — sync docs with code
    (depends on: test-runner)
```

## Architecture Layers

| Layer    | Package                    | Agents                                |
| -------- | -------------------------- | ------------------------------------- |
| Core     | `packages/core/src/`       | i18n, validation, translation, topics |
| Adapters | `packages/adapters/*/src/` | db, ai, notifications                 |
| App      | `apps/bot/src/`            | bot                                   |
| Quality  | —                          | test-runner, doc-validator            |

## Boundary

- **Mode:** role — when this skill is active, you ARE the technical pipeline orchestrator. Implement tasks from docs/tasks/.
- **Produces:** source code, tests, and updated docs across `packages/`, `apps/`, `docs/`
- **Never:** modify business artifacts (BRD, roadmap, requirements) — only read them for context
- **Never:** skip tests or quality gates
- **Each sub-agent owns its layer** — no cross-boundary code changes between sub-agents
- **Allowed tools:** `read`, `bash`, `edit`, `write`
- **Allowed write paths:** `packages/**`, `apps/**`, `docs/tasks/**`, `.pi/skills/**`

## Rules

- Read task specs from `docs/tasks/` before implementing
- Each sub-agent owns its layer — no cross-boundary code changes
- All agents write tests and update documentation
- Final quality gates: test-runner → doc-validator
- Technical pipeline does NOT depend on business pipeline — decoupled by artifacts

## Relationship with Business Pipeline

The business pipeline produces artifacts in `docs/`:

- `docs/tasks/` — task specs (consumed by all implementation agents)
- `docs/tech-reqs/` — technical design docs (consumed by implementation agents)
- `docs/BRD.md` — business requirements (reference only)

The technical pipeline runs **asynchronously** — in separate `orchestrate` calls after business artifacts are ready.
