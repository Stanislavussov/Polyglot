# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Added a risk-based translation quality pipeline: deterministic immutable-token checks, sentence semantic validation, cross-model judging for high-risk requests, and targeted repair of only failing language blocks.
- Added pre-generation clarification for locale-ambiguous numeric dates and mixed-script/transliterated input. Lexical ambiguity is not hard-coded to specific phrases and remains risk-routed until ranked sense confidence is available.
- Added structured semantic-judge output with field-level severity and repair instructions.
- Added `input-analysis` core module with `analyzeInput()` — classifies user input as word/phrase/sentence and detects structural features (placeholders, URL, Markdown, dates, code-switching). Feature-based overrides reclassify URL-only and code-switched short input as "sentence". The module is a leaf with no sibling imports; `InputType` is now owned by this module and re-exported from `translation` for backward compatibility.
- Added `detectLanguageWithConfidence()` and `detectLanguageWithConfidenceAsync()` — confidence-aware language detection returning `DetectionResult` with `{ language?, confidence, evidence, ambiguousCandidates? }` instead of a bare `string | undefined`. Uses candidate-aware scoring: each strategy contributes evidence scores per candidate, and the ensemble picks the highest-scoring candidate with a confidence threshold (≥0.7) and margin (≥0.2). Close-language pairs (cs/sk, hr/sr) are disambiguated by differential diacritics rather than ordered-regex first-match.
- Added `DetectionEvidence` and `DetectionResult` types to the language-detect module.
- Added `detectionConfidence` optional field to `QualityMetadata` for tracking source-language detection confidence on accepted translations.
- Added `langSelectPrompt` i18n key (en/ru/cs) for the language selection prompt shown when detection is ambiguous.
- Added `handleLangSelectCallback` and `tr:langselect:$lang` callback — when detection is ambiguous with candidate languages, the bot shows inline keyboard buttons (one per candidate) instead of the generic mistype warning. The user selects a source language and the translation proceeds with that direction.
- Added `TranslationDecision` contract — `translate()`, `translateOne()`, and `translateBatch()` now return a discriminated union with three statuses: `accepted` (translation passed validation, includes `QualityMetadata`), `needs_clarification` (ambiguity detected, includes `TranslationAmbiguity`), and `needs_review` (validation failed after retries, includes `QualityIssue[]`). This replaces the former `needsReview: boolean` flag on `TranslateOutput`.
- Added typed ambiguity reasons (`source_language`, `word_sense`, `date_or_time`, `placeholder_grammar`, `mixed_or_transliterated_input`) and `TranslationAmbiguityOption` for structured user clarification flows.
- Added `QualityMetadata` type tracking `promptVersion`, `schemaVersion`, `riskLevel`, `modelId`, `attemptCount`, `judgeResult`, `issues`, and `detectionConfidence` on accepted translation decisions.
- Added `QualityIssue` type with `fieldPath`, `severity` (`blocking`/`warning`/`info`), `message`, and optional `repairInstruction`.
- Added `RiskLevel` type (`low`/`medium`/`high`) for future risk-based validation routing.
- Added `PROMPT_VERSION` and `SCHEMA_VERSION` constants to the translation service for version tracking in quality metadata.
- Translation benchmark `evaluateTranslationQuality` now checks `decision.status` against `expectedAction` and reports status mismatches with the actual status value.

### Changed

- Full translation retries now handle only generation and schema failures; deterministic and judge failures use bounded per-language targeted repair instead of replacing accepted translation blocks.
- Sentence validation now skips only the source-equality guard while retaining hallucination and immutable-content checks.
- Validation orchestration moved from the barrel file into `validation.service.ts`; `validation/index.ts` now contains re-exports only.
- Updated translate-mode test fixtures to exercise the confidence-aware language-detection guards deterministically.
- `InputType` definition moved from `translation/types.ts` to `input-analysis/types.ts`; `translation` re-exports it for backward compatibility. The bot's `classify-input.ts` is now a thin re-export from `@polyglot/core` instead of a local implementation.
- Bot translate flow now uses `detectLanguageWithConfidence` / `detectLanguageWithConfidenceAsync` instead of `detectLanguage` / `detectLanguageAsync`. Ambiguous detections with candidate languages show language-selection buttons instead of the generic mistype warning; truly inconclusive detections (no evidence) still show the mistype warning.
- Translation benchmark runner `detectLanguageFn` type changed from `(text, candidates) => Promise<string | undefined>` to `(text, candidates) => Promise<DetectionResult>`. `DetectionBenchmarkResult` now includes `confidence`, `evidence`, and `ambiguousCandidates` fields. The benchmark CLI uses `detectLanguageWithConfidenceAsync`.
- Dependency-cruiser rules updated: `input-analysis` added as a leaf module (no sibling imports), and added to the forbidden import lists of all other leaf modules.
- `translateWithContext()`, `translateOneWithContext()`, and `translateBatchWithContext()` now return `TranslationDecision` / `TranslationDecision[]` instead of `TranslateOutput` / `TranslateOutput[]` / `LanguageTranslation`.
- `translateOne()` now returns `TranslationDecision` instead of `LanguageTranslation`; callers extract the per-language translation from `decision.output.translations[lang]`.
- `renderTranslation()` and `renderSentenceTranslation()` now accept an optional `needsReview` parameter instead of reading `output.needsReview`.
- Removed `needsReview` field from `TranslateOutput` — the decision status carries this information.
- Translation benchmark `CompletedBenchmarkCase.result` field renamed to `decision` and typed as `TranslationDecision`.

### Added (previous entries)

- Added versioned, executable translation benchmark assertions for ambiguity actions, immutable placeholders/Markdown/URLs/proper names, forbidden meanings, and required metadata. Reports now include quality pass/fail results, prompt/schema versions, and model settings, and the CLI fails when a quality assertion fails.
- Added per-user per-day request counts to the admin panel — a new `GET /api/stats/user-request-counts` endpoint aggregates translation requests by user and day (without exposing request bodies), and a new Request Stats page displays the counts as a pivot matrix with a selectable 7/14/30/60/90-day window.
- Added a benchmark CLI with 30 translation-quality scenarios and 72 source-language detection scenarios. It exercises the production translation, validation, retry, Wiktionary, and AI-detection paths through one selected OpenRouter model and saves analysis-ready JSON reports with raw attempts, expected quality risks, and ambiguity decisions.
- Added a `smoke` benchmark group with 5 translation and 10 source-detection scenarios for quickly verifying the end-to-end benchmark setup before running the complete dataset.
- Added a comprehensive translation-quality program and visual architecture roadmap covering model selection, field validation, dictionary sense selection, learning-data persistence, evaluation, and verified caching.
- Added per-target `usageNote` guidance in the user's native language, persisted separately from exceptional `connotationWarning` metadata and rendered with a distinct marker.
- Added vocabulary-entry `sourceUsage` persistence on the normalized dictionary path, plus flashcard, dictionary, and SRS rendering for saved source-language guidance.
- Added deterministic response-field validation for duplicated target/native examples, Latin-script Russian romanization, wrong-script Russian explanations, embedded pronunciation/IPA markers, and notes copied across language blocks.
- **Mentor mode** (`/mentor` command) — chat with an AI language-learning coach that helps you translate and learn words through guided conversation. The mentor coaches you instead of translating immediately, keeps responses short, and remembers conversation context within a session. Responses are capped at 300 tokens to stay concise.
- Added reverse-learning source usage details: when users translate from a learning language, word cards can now show source-language examples, source-language synonyms, and a native-language explanation of when to use the word.
- Added multiple vocabulary dictionaries in the bot. `/dictionary` now opens the default `My Words` dictionary, users can create, rename, delete, switch between dictionaries, and add or move saved words between them.
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
- Added pre-request language detection with mistype validation — the bot detects the input language before running the AI translation and shows a confirm/cancel warning when the language cannot be identified (likely a typo), replacing the manual source language selection menu.
- Added language detection event tracking — mistype warnings, confirmations, and cancellations are now recorded in a `language_detection_events` table and visualized in the admin dashboard with a stacked bar chart and confirm/cancel rate summary.

### Fixed

- Translation benchmark CLI now loads the repository root `.env` when invoked through its workspace package, so configured OpenRouter credentials are available to smoke and full runs.
- Translation benchmark CLI now closes its read-only database connection after report generation instead of keeping the process alive.
- Docker build dependency stages now include the translation benchmark workspace manifest, allowing full monorepo builds to resolve its internal adapter dependencies.
- Language detection no longer chooses the first configured language when a single spelling exists in multiple Wiktionary languages; ambiguous homographs now remain unresolved instead of being sent to AI for a forced guess.
- Saved source-usage explanations no longer label the interface language as though it were the user's native language.
- Example validation now checks multi-word and Unicode translations instead of skipping them, with conservative inflection matching for Czech and Russian examples.
- Fixed native-language target examples requiring a redundant same-language `native` translation, which could cause models to return duplicated sentences or romanized Russian text.
- Translation prompts now forbid pronunciation, IPA, romanization, and transliteration in every response field from the first generation attempt.
- Localized dictionary item type labels in SRS review, flashcards, and dictionary details, so Russian UI shows `слово` instead of the raw English `word` enum.
- Fixed "Open dictionary" notification button — now calls the dictionary handler directly instead of sending `/dictionary` as plain text.
- Prevented same-language learning blocks from drifting away from the detected source expression, so cases like Czech `kudlanka` cannot be accepted as Czech `klubko`.
- Made connotation notes render as informational text instead of warning-style alerts.
- Generated missing migration for `translation_request_timings` table that was preventing the Request Timing Breakdown chart from loading.
- `requestTimingRepository.record()` now silently ignores missing-table errors instead of logging a warning, so the bot does not emit noise before the migration is applied.
- Fixed translation cards showing `nativeMeaning` when `nativeLang` equals `sourceLang` — users with native English inputting English words no longer see an English "translation" block.
- Removed flawed guard from `resolveTranslationDirection` and `resolveDirectionFromSource` that re-included the source language into `targetLangs` when the user had only one learning language; this prevented empty cards caused by `hideSourceText` skipping the sole (same-language) target.
- Fixed translation cards and flashcards not showing the user's native language when translating from a learning language — `resolveTranslationDirection` and `resolveDirectionFromSource` now include `nativeLang` in `targetLangs` (unless it equals the source language), so users see translations back to their native language alongside other learning languages.
- The native-language target block is now minimal when translating from a learning language: the AI returns only the direct translation word and synonyms, omitting examples, alternatives, usage notes, and connotation warnings. The Zod schema, validation, and prompt all enforce this — source-language examples with native translations in `sourceUsage` already demonstrate usage, and the user already knows their native language.
- Translation cards now render the native-language translation as a bold header inside the source-usage block (e.g. `🇷🇺 RU: черника (черничка)`) followed by the explanation as a `💡` note, instead of showing only a description line.

### Changed

- Translation benchmark reports are now stored as Markdown under `docs/translation-benchmarks/` instead of local JSON files.
- Dictionary context lookup now normalizes Unicode, case, and whitespace, supports imported Wiktionary forms, and returns deterministically ordered sense candidates instead of silently selecting the first database row.
- Translation prompts now state more explicitly that `connotationWarning` must be written in the user's native language even inside non-native target blocks, not in the target language.
- Translation structured-output requests now use `frequencyPenalty: 0` so example generation can repeat the assigned translation naturally; other AI requests retain the adapter default unless they explicitly override it.
- Removed the post-translation source language selection menu (`sendSourceLangMenu`, `buildSourceLangKeyboard`, `handleSourceLangCallback`, `buildLangOptions`) — language detection now runs automatically on every translation request, so the manual source picker is no longer shown after Save/Skip/Regen or `/translate`.
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
