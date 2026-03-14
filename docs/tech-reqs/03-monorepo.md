# Monorepo (pnpm workspaces)

```json
// package.json (root)
{
  "private": true,
  "workspaces": ["packages/core", "packages/adapters/*", "apps/*"]
}
```

```json
// apps/bot/package.json
{
  "name": "@polyglot/bot",
  "dependencies": {
    "@polyglot/core": "workspace:*",
    "@polyglot/adapter-db": "workspace:*",
    "@polyglot/adapter-ai": "workspace:*",
    "@polyglot/adapter-notifications": "workspace:*"
  }
}
```

