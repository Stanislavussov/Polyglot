# Quality Gate

After source-code changes, update `CHANGELOG.md` and run:

```bash
pnpm build && pnpm lint && pnpm lint:deps && pnpm lint:knip && pnpm test && pnpm db:push
```

Fix failures before proceeding.

## Documentation-Only Exception

When the only touched files are Markdown, task specs, readmes, or changelogs, skip the
full gate. Verify the Markdown change by inspection and update `CHANGELOG.md` when the
change is user-facing or operational.

## Database Notes

- `pnpm db:push` is the final local/dev schema sync step.
- Do not run `pnpm db:migrate` locally unless the user explicitly asks for it.
- If schema changed, generate and review migrations before pushing.

## Changelog

Keep user-facing and operational changes under `## [Unreleased]`.
