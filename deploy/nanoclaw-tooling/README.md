# Nanoclaw Tooling

This compose bundle is the Polyglot-owned verification runner used by the factory Nanoclaw runtime.

Nanoclaw runs these commands through `polyglot-tooling`:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm lint:deps
pnpm test
```

Run manually from the Polyglot repository root:

```bash
docker compose -f deploy/nanoclaw-tooling/compose.yml run --rm polyglot-tooling install --frozen-lockfile
docker compose -f deploy/nanoclaw-tooling/compose.yml run --rm polyglot-tooling build
docker compose -f deploy/nanoclaw-tooling/compose.yml run --rm polyglot-tooling lint
docker compose -f deploy/nanoclaw-tooling/compose.yml run --rm polyglot-tooling lint:deps
docker compose -f deploy/nanoclaw-tooling/compose.yml run --rm polyglot-tooling test
```

Keep application tooling here, not on the VPS host and not in the Nanoclaw runtime image.
