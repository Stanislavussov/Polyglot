---
name: deploy
description: Thin harness adapter for app deploy, Ansible host provisioning, and GitHub secrets.
---

# Deployment Adapter

This is a thin harness adapter. Canonical, shared agent guidance lives in `@docs/agents/`.
Do not put changing domain knowledge, long API inventories, or task status in this file.

## Read First
- `@docs/agents/deployment.md`
- `@docs/agents/quality-gate.md`

## Scope
- App deploy (`deploy.yml`) ships containers only; host provisioning (`pnpm ansible`) handles nginx/TLS/host config — keep them separate.
- Production provisioning and GitHub secret changes follow `@docs/agents/deployment.md`.

## Before Editing
- Inspect the current source and config directly.
- Prefer existing repo patterns over new abstractions.
- Keep edits scoped to the active task.

## Run When Code Changes
- Changed `deploy/ansible/**` / nginx routing, or added a domain/service needing host routing → re-apply with `pnpm ansible` (the change is dormant until then; prod still needs explicit go-ahead, confirm DNS first).
- Added/changed an infra var in `.env.prod` that Ansible or the deploy workflow consumes → push it with `gh secret set`.
- App-code/container-only changes → none of this applies.

## Hard Stops
- Do not run `pnpm ansible` against production without an explicit, separate user request — same posture as `pnpm db:migrate`.
- Do not sync `VPS_SSH_KEY` from `.env.prod` to GitHub (path locally vs key contents in CI).

## After Editing
- Update `CHANGELOG.md` when required.
- Update durable docs under `@docs/` when behavior or operations changed.
- Run the applicable gate from `@docs/agents/quality-gate.md`.
