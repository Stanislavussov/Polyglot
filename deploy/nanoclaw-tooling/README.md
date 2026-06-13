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
docker compose -f deploy/nanoclaw-tooling/compose.yml run --rm polyglot-tooling pnpm install --frozen-lockfile
docker compose -f deploy/nanoclaw-tooling/compose.yml run --rm polyglot-tooling pnpm build
docker compose -f deploy/nanoclaw-tooling/compose.yml run --rm polyglot-tooling pnpm lint
docker compose -f deploy/nanoclaw-tooling/compose.yml run --rm polyglot-tooling pnpm lint:deps
docker compose -f deploy/nanoclaw-tooling/compose.yml run --rm polyglot-tooling pnpm test
```

Keep application tooling here, not on the VPS host and not in the Nanoclaw runtime image.

## Environment Variables

- `NANOCLAW_POLYGLOT_HOST_DIR` — absolute host path to the Polyglot repository root. When unset, defaults to `../..` relative to the compose file (the Polyglot repo root).
