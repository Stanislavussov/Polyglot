# Deployment

## Option 1: Railway (current production)

```
Railway Project
├── Service: bot (Node.js process)
│     ├── grammY        — long-polling, listens to Telegram messages
│     ├── node-cron     — notifications, runs inside the same process
│     └── Drizzle ORM   — DB connection
│
└── Service: PostgreSQL (Railway managed)
```

No HTTP API by design — Telegram delivers messages to the bot itself.

## Option 2: Docker Compose (self-hosted / local dev)

### Prerequisites

- Docker & Docker Compose installed
- `.env` file in the project root (see `.env.example`)
- External PostgreSQL (Neon DB) — no local Postgres container needed

### Quick Start

```bash
# Clone and configure
git clone <repo-url> && cd Polyglot
cp .env.example .env
# Edit .env with your BOT_TOKEN, DATABASE_URL, OPENROUTER_API_KEY, etc.

# Start the bot (via pnpm scripts or directly)
pnpm docker:up                # or: docker compose -f deploy/docker-compose.yml up
pnpm docker:up:build           # rebuild after code changes
pnpm docker:up:detach          # run in background
pnpm docker:down               # stop
pnpm docker:logs               # tail bot logs
```

### Running Migrations

The `migrate` service uses the full build image (with drizzle-kit) to push schema changes:

```bash
pnpm docker:migrate
# or: docker compose -f deploy/docker-compose.yml run --rm migrate
```

> **Production workflow**: run `docker compose run --rm migrate` before starting the bot after schema changes. The bot service itself does not run migrations automatically.

### Architecture

```
┌─────────────────────────────────────┐
│  bot  (:9090/metrics, /healthz)     │
│  ├── node apps/bot/dist/index.js    │
│  ├── grammY (long-polling)          │
│  ├── node-cron (notifications)      │
│  └── Drizzle ORM                    │
└───────┬───────────────┬─────────────┘
        │               │
        ▼               ▼
┌───────────────┐ ┌───────────────┐
│  Prometheus   │ │  Neon DB      │
│  (scrapes)    │ │  (external PG)│
└───────┬───────┘ └───────────────┘
        │
        ▼
┌───────────────┐
│  Grafana      │
│  (:3000)      │
└───────────────┘
```

### Monitoring

Grafana is exposed on port `3000` (configurable via `GRAFANA_PORT` in `.env`).
Default credentials: `admin` / `admin` (override with `GRAFANA_USER` / `GRAFANA_PASSWORD` in `.env`).

A pre-built **Polyglot Bot Overview** dashboard is auto-provisioned with:
- Bot uptime, memory, CPU
- Telegram messages/min by type
- Translations/min, duration percentiles (p50/p95/p99)
- AI requests & token usage by model
- Notification delivery rates
- Node.js event loop lag & active handles

Prometheus retains data for 30 days. Both Prometheus and Grafana data persist across restarts via Docker volumes.

### File Layout

```
Polyglot/
├── deploy/
│   ├── Dockerfile                              # multi-stage build
│   ├── docker-compose.yml                      # service definitions
│   ├── prometheus/prometheus.yml                # scrape config
│   └── grafana/
│       ├── dashboards/bot-overview.json         # pre-built dashboard
│       └── provisioning/
│           ├── datasources/datasource.yml       # Prometheus datasource
│           └── dashboards/dashboard.yml         # dashboard provider
├── .dockerignore                                # build context filter (must be in root)
└── .env                                         # environment variables
```

### Image Details

- Base: `node:22-alpine`
- Multi-stage build: `base` → `deps` → `build` → `production`
- Separate `migrate` stage for running drizzle-kit migrations
- Production dependencies only in the final image (no devDependencies)
- Runs as non-root `node` user
- Healthcheck via HTTP (`/healthz` on `:9090`)
- Prometheus metrics exposed at `/metrics` on `:9090`
- Graceful shutdown on `SIGTERM` (grammY `bot.stop()`)
