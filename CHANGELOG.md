# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Added automatic cleanup of technical messages — menus, settings, hints, onboarding prompts, and other non-translation bot messages are now deleted after a scene ends or settings change. Only translation result cards remain in the chat history.
- Added pre-translation dictionary lookup — when a user translates a word or phrase that already exists in their personal dictionary, the Save button is shown as disabled ("✅ Saved") instead of the active "💾 Save" button.
- Added synonyms context to word notifications — each translation line now shows synonyms below the translation text when available.
- Added "View" button to admin reported issues table that opens a modal showing the full issue description and all details.
- Added technical debt task docs for five architecture deepening opportunities: translation workflow, translation card lifecycle, dictionary decks, settings registry, and composition root typing.
- Added native-language meanings to translation output, saved vocabulary entries, dictionary views, flashcards, SRS cards, and word notifications.
- Added a `native_meaning` column to `vocabulary_entries` for persisted dictionary reuse.
- Added status editing to admin reported issues — inline dropdown in the table and a dropdown in the detail modal, backed by a new `PUT /api/reported-issues/:id/status` endpoint.
- Added pre-AI validation for translation input, accepting sentences up to 500 characters while rejecting empty, emoji-only, command-like, digits-only, and over-limit input.
- Added Telegram-user audience groups for release announcements.
- Added a post-deploy release announcement job that sends `Unreleased` changelog notes to `admin` and `tester` bot users.
- Added a `/changes` bot command for tester and admin audience groups to view delivered changes.
- Added `PUT /api/reported-issues/:id/status` endpoint to admin API for updating reported issue status.
- Added inline status dropdown to admin reported issues table and modal for direct status changes.
- Added segment-level request timing instrumentation for translation requests (preflight, DB lookup, AI request, total duration).
- Added `translation_request_timings` table to store per-request segment breakdowns.
- Added `/api/stats/request-timings` admin API endpoint for aggregated timing data.
- Added Request Timing Breakdown chart to admin dashboard showing stacked bar chart of segment durations by day and by model.

### Fixed

- Localized dictionary item type labels in SRS review, flashcards, and dictionary details, so Russian UI shows `слово` instead of the raw English `word` enum.
- Fixed "Open dictionary" notification button — now calls the dictionary handler directly instead of sending `/dictionary` as plain text.
- Prevented same-language learning blocks from drifting away from the detected source expression, so cases like Czech `kudlanka` cannot be accepted as Czech `klubko`.
- Made connotation notes render as informational text instead of warning-style alerts.
- Generated missing migration for `translation_request_timings` table that was preventing the Request Timing Breakdown chart from loading.
- `requestTimingRepository.record()` now silently ignores missing-table errors instead of logging a warning, so the bot does not emit noise before the migration is applied.
- Fixed translation cards showing `nativeMeaning` when `nativeLang` equals `sourceLang` — users with native English inputting English words no longer see an English "translation" block.
- Removed flawed guard from `resolveTranslationDirection` and `resolveDirectionFromSource` that re-included the source language into `targetLangs` when the user had only one learning language; this prevented empty cards caused by `hideSourceText` skipping the sole (same-language) target.
- Fixed translation cards and flashcards not showing the user's native language when translating from a learning language — `resolveTranslationDirection` and `resolveDirectionFromSource` now include `nativeLang` in `targetLangs` (unless it equals the source language), so users see translations back to their native language alongside other learning languages.

### Changed

- Sentence translations (>6 words) can now be saved to the personal dictionary, removing the previous restriction that only allowed words and phrases. The database `text` columns (`vocabulary_entries.original` and `vocabulary_translations.text`) have no length limit, so the effective boundary is the existing 500-character input validation cap.
- Admin users management now shows and updates each bot user's audience group.
- Removed transcription feature from translation output, prompts, validation, and database schema.
- Updated translation direction resolvers to exclude source language from targets, with guard against empty target arrays.
- Generated migration `0029_amusing_luckman.sql` to drop `transcription` columns from `user_translation_templates` and `vocabulary_translations`.
- Agent implementation guidance now requires updating `CHANGELOG.md` after every implementation iteration.
- Database-change guidance now requires `pnpm db:push` on `develop` after generated migrations, while keeping `pnpm db:migrate` CI/deploy-only.
- Bot Docker builds now include `CHANGELOG.md` for the `/changes` command.
- Added Task 62: Separate Deployment Environments (Prod/Dev/Testing) with environment-specific Docker Compose files, CI/CD workflows, and database isolation.
- Added Task 63: Parameterize Bot by Environment (`production`, `development`, `testing`) including per-environment bot tokens, logging levels, error handling, and release announcement gating.
- Added Task 64: Application Clustering into Core (bot), Management (admin-api + admin), and Data (migrations + scheduler) clusters with independent deploy scripts.
- Added Task 65: Dual Database Instance Separation on Single VPS — Docker Swarm-based production and testing database isolation with independent stacks, backup scripts, and resource limits.
