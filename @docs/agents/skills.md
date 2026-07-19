# Skill Role Index

A compact index of the roles/concerns that make up the project, for orienting work.
It points to `@docs/agents/` and active `@docs/` documents rather than carrying long,
drifting domain descriptions — for per-module design invariants see the Module Contracts
in `@docs/agents/architecture.md`.

## Business Roles

- `product` - competitor and market research. Output temporary analysis unless the
  workflow explicitly publishes docs.
- `research` - stress-test hypotheses and produce a verdict.
- `business-analyst` - turn research into requirements.
- `product-owner` - prioritize scope and roadmap.
- `architect` - produce technical designs and boundary decisions.
- `task-creator` - create implementation task specs.
- `brd-grooming` - compare tasks against BRD.
- `integrator` - check cross-artifact consistency.

## Technical Roles

- `infra` - configuration, logging, and cross-cutting utilities.
- `translation-template` - output templates, presets, and shared translation display
  configuration.
- `i18n` - localized bot text and language display utilities.
- `validation` - deterministic response validation and schema checks.
- `db` - Drizzle schema, repositories, and persistence.
- `ai` - AI provider adapter and model/request plumbing.
- `translation` - prompt building, translation orchestration, and response shaping.
- `context-enrichment` - pre-AI context lookup and enrichment.
- `dictionary-pipeline` - dictionary-derived display/read models.
- `topics` - topic datasets, custom topic generation, and topic caches.
- `notifications` - scheduling and delivery of notifications.
- `bot` - Telegram commands, scenes, middleware, callbacks, and renderers.
- `doc-validator` - docs accuracy checks after implementation.
- `test-runner` - quality-gate execution and failure diagnosis.
- `testing-strategy-tdd` - spec-first TDD, test selection, integration-focused coverage,
  and test anti-pattern review.

## Reading Rule

Read the active task and source code before editing. Do not rely on a skill file as an
API inventory or implementation map.
