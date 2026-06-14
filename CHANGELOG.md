# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Added Telegram-user audience groups for release announcements.
- Added a post-deploy release announcement job that sends `Unreleased` changelog notes to `admin` and `tester` bot users.
- Added a `/changes` bot command for tester and admin audience groups to view delivered changes.
- Added segment-level request timing instrumentation for translation requests (preflight, DB lookup, AI request, total duration).
- Added `translation_request_timings` table to store per-request segment breakdowns.
- Added `/api/stats/request-timings` admin API endpoint for aggregated timing data.
- Added Request Timing Breakdown chart to admin dashboard showing stacked bar chart of segment durations by day and by model.

### Changed

- Admin users management now shows and updates each bot user's audience group.
- Agent implementation guidance now requires updating `CHANGELOG.md` after every implementation iteration.
- Database-change guidance now requires `pnpm db:push` on `develop` after generated migrations, while keeping `pnpm db:migrate` CI/deploy-only.
- Bot Docker builds now include `CHANGELOG.md` for the `/changes` command.
