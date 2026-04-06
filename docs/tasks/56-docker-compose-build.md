# Task 56 — Docker Compose Build for Bot App

**Status:** 🔲 To Do  
**Category:** DevOps / Infrastructure — Medium  
**Blocks:** Local development parity, self-hosted deployment, future CI/CD

---

## Goal

Containerize the Polyglot bot with Docker and provide a `docker-compose.yml` for one-command startup. The database is **Neon DB** (managed PostgreSQL) — no local Postgres container needed. Currently the project has zero Docker support — developers must manually install Node.js 22 and pnpm, and Railway handles production deployment. A Docker Compose setup enables:

- **One-command local dev** — `docker compose up` boots the bot
- **Self-hosted deployment** — run on any VPS (Hetzner, DigitalOcean) without Railway
- **Environment parity** — same OS and Node version everywhere

## Required Behavior

1. Multi-stage `Dockerfile` that builds the pnpm monorepo and produces a minimal production image running `apps/bot`
2. `docker-compose.yml` with the bot service (connects to external Neon DB via `DATABASE_URL`)
3. `.dockerignore` to keep the image lean
4. Environment variables injected via `.env` file (already exists per `docs/tech-reqs/13-env.md`)
5. Drizzle migrations run automatically on bot startup (or via a compose entrypoint)

## Acceptance Criteria

### Dockerfile
- [ ] Multi-stage build: `base` → `deps` → `build` → `production`
- [ ] Base image: `node:22-alpine`
- [ ] Uses `corepack enable && corepack prepare pnpm@latest --activate` for pnpm
- [ ] `deps` stage: copies `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and all workspace `package.json` files, then runs `pnpm install --frozen-lockfile`
- [ ] `build` stage: copies source, runs `pnpm build`
- [ ] `production` stage: copies only `node_modules` and built `dist/` artifacts, runs as non-root user
- [ ] Final image runs `node apps/bot/dist/index.js`
- [ ] Image size < 300 MB (alpine + pruned deps)

### docker-compose.yml
- [ ] Service `bot`: builds from `Dockerfile`, restarts on failure (`restart: unless-stopped`)
- [ ] No local Postgres — connects to external **Neon DB** via `DATABASE_URL` from `.env`
- [ ] Environment variables loaded from `.env` file via `env_file: .env`
- [ ] Optional: entrypoint script that runs `pnpm drizzle-kit push` / `pnpm drizzle-kit migrate` before the bot starts

### .dockerignore
- [ ] Ignores: `node_modules`, `dist`, `.git`, `.env`, `coverage`, `.vitest`, `docs`, `.pi`

### Developer Experience
- [ ] `docker compose up` from a clean clone + `.env` file starts the bot successfully
- [ ] `docker compose up --build` rebuilds after code changes
- [ ] `docker compose down` cleanly stops the bot
- [ ] README or `docs/tech-reqs/12-deployment.md` updated with Docker instructions

### Production Readiness
- [ ] Bot container runs as non-root user (`USER node` or custom)
- [ ] Container has a healthcheck (process alive, or HTTP if Task 55 adds `/healthz`)
- [ ] `NODE_ENV=production` set in production stage
- [ ] No dev dependencies in the production image (`pnpm install --prod` or prune)
- [ ] Graceful shutdown: bot handles `SIGTERM` (grammY's `bot.stop()` already does this)

## Dependencies

- None (standalone task)
- Benefits from Task 55 (Health Check) for container healthcheck endpoint
- Benefits from Task 42 (Composition Root & DI) for clean startup

## Effort Estimate

3–4 hours (Dockerfile: 1.5h, docker-compose: 1h, testing & docs: 1h)

## Files Likely Affected

- `Dockerfile` — **NEW** multi-stage build
- `docker-compose.yml` — **NEW** service orchestration
- `.dockerignore` — **NEW** build context filter
- `docs/tech-reqs/12-deployment.md` — update with Docker instructions
- `apps/bot/src/index.ts` — verify graceful shutdown on SIGTERM
