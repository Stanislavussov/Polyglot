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

## Test Catalog

`apps/admin/reports-data/test-catalog.{json,html}` is generated from the test files
(scenario extraction) and is also rewritten as a side effect of `pnpm reports:sync-admin`.
(The reports directory was moved out of `apps/admin/public/` in Fable T09, so reports are
no longer served anonymously; they sit behind the cookie-gated SSR endpoint
`apps/admin/src/pages/reports/[...file].ts`.)

- Run `pnpm test:catalog` and commit the regenerated artifacts **only when test files
  changed**.
- If they show as modified but no tests changed (spurious regeneration), keep them out of
  the commit: `git restore apps/admin/reports-data/test-catalog.*`.

## Changelog

Keep user-facing and operational changes under `## [Unreleased]`.
