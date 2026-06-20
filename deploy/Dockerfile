# ── Stage 1: base ─────────────────────────────────────────────────────
FROM node:26-alpine AS base
RUN npm install -g pnpm@10.14.0
WORKDIR /app

# ── Stage 2: deps ─────────────────────────────────────────────────────
FROM base AS deps

# Copy only files needed for dependency resolution
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/bot/package.json apps/bot/
COPY apps/admin-api/package.json apps/admin-api/
COPY apps/admin/package.json apps/admin/
COPY apps/translation-benchmark/package.json apps/translation-benchmark/
COPY packages/core/package.json packages/core/
COPY packages/infra/package.json packages/infra/
COPY packages/adapters/ai/package.json packages/adapters/ai/
COPY packages/adapters/db/package.json packages/adapters/db/
COPY packages/adapters/notifications/package.json packages/adapters/notifications/

RUN pnpm install --frozen-lockfile

# ── Stage 3: build ────────────────────────────────────────────────────
FROM deps AS build

# Copy all source code
COPY tsconfig.json ./
COPY apps/ apps/
COPY packages/ packages/

RUN pnpm build

# ── Stage 4: production ──────────────────────────────────────────────
FROM base AS production

ENV NODE_ENV=production

# Copy lockfile and workspace manifests for prod install
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/bot/package.json apps/bot/
COPY apps/admin-api/package.json apps/admin-api/
COPY apps/admin/package.json apps/admin/
COPY packages/core/package.json packages/core/
COPY packages/infra/package.json packages/infra/
COPY packages/adapters/ai/package.json packages/adapters/ai/
COPY packages/adapters/db/package.json packages/adapters/db/
COPY packages/adapters/notifications/package.json packages/adapters/notifications/

RUN pnpm install --frozen-lockfile --prod

# Runtime bot command reads delivered changes from the changelog.
COPY CHANGELOG.md ./

# Copy built artifacts from build stage
COPY --from=build /app/apps/bot/dist apps/bot/dist
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/infra/dist packages/infra/dist
COPY --from=build /app/packages/adapters/ai/dist packages/adapters/ai/dist
COPY --from=build /app/packages/adapters/db/dist packages/adapters/db/dist
COPY --from=build /app/packages/adapters/notifications/dist packages/adapters/notifications/dist

# Run as non-root
USER node

EXPOSE 9090

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:9090/healthz || exit 1

CMD ["node", "apps/bot/dist/index.js"]

# ── Stage 5: migrate (optional) ──────────────────────────────────────
# Usage: docker compose run --rm migrate
FROM build AS migrate

ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@polyglot/adapter-db", "run", "db:migrate"]
