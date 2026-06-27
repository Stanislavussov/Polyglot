# Agent Workflows

## Implementation

1. Read the active task in `@docs/tasks/`.
2. Read the relevant stable guidance in `@docs/agents/`.
3. Inspect source code directly.
4. Make scoped changes.
5. Update docs and changelog when required.
6. Run the applicable quality gate.

## Business Planning

Use temporary working files for intermediate research and planning. Publish only the
final agreed artifact to `@docs/` unless the user asks for multiple artifacts.

## Documentation Hygiene

- Keep long-lived domain docs in `@docs/`.
- Keep harness-specific skill files short.
- Do not duplicate API inventories, file trees, or task status across skill files.
- Move completed task specs to `@docs/tasks/finished/` when the repo workflow requires it.

## Review

Lead with findings ordered by severity. Ground each finding in file and line references.
If there are no findings, say so and note residual test or verification gaps.
