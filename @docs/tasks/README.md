# Polyglot — Tasks

## Active

| #   | Task                                              | Status     |
| --- | ------------------------------------------------- | ---------- |
| 06  | [AI Token Optimization](./06-token-optimization.md) | 🔲 To Do  |
| 08  | [AI Model Fallback](./08-model-fallback.md)       | 🔲 To Do  |
| 11  | [Input Message Limits & Validation Config](./11-input-limits-config.md) | 🔲 To Do  |
| 14  | [Refactor Language Usage to `languages` Table](./14-language-table-refactor.md) | 🟡 Partial |
| 18  | [Language Buttons Native Display](./18-language-buttons-native-display.md) | 🔲 To Do  |
| 24  | [Token Usage Tracking](./24-token-usage-tracking.md) | 🔲 To Do  |
| 26  | [Diacritics-Aware Translation](./26-diacritics-aware-translation.md) | 🔲 To Do  |
| 29  | [Require Source Language Before Translation](./29-require-source-lang-before-translate.md) | ❌ Superseded by Task 58 |
| 35  | [Localized Bot Command Descriptions](./35-localized-bot-commands.md) | 🟡 Partial |
| 36  | [Fix Onboarding Back-Navigation](./36-fix-onboarding-back-navigation.md) | 🔲 To Do |
| 37  | [Lite AI Translation Validator](./37-lite-ai-translation-validator.md) | 🟡 Partial (types/schema done, service not wired) |
| 38  | [Fix Onboarding Demo Translation](./38-fix-onboarding-demo-translation.md) | 🔲 To Do |
| 39  | [Hide Source Lang Menu Multiple Targets](./39-hide-source-lang-menu-multiple-targets.md) | 🔲 To Do |
| 40  | [Sync Username on Every Request](./40-sync-username-on-every-request.md) | 🔲 To Do |
| 57  | [Source Language Examples](./57-source-lang-examples.md) | 🔲 To Do |
| 58  | [Language Detection Pre-Request](./58-language-detection-pre-request.md) | 🔲 To Do |
| 60  | [Context Hint Marker Mode](./60-context-hint-marker-mode.md) | ✅ Done |

## Architecture — Debt Reduction

| #   | Task                                              | Status     | Priority |
| --- | ------------------------------------------------- | ---------- | -------- |
| 42  | [Composition Root & Dependency Injection](./42-composition-root-and-di.md) | ✅ Done (infra complete, incremental migration in progress) | 🔴 Critical |
| 43  | [Persistent Session Storage with Versioning](./43-persistent-session-storage.md) | 🔲 To Do | 🔴 Critical |
| 44  | [Unify Language Cache with TTL Refresh](./44-unify-language-cache.md) | 🔲 To Do | 🟠 High |
| 45  | [Extract Domain Types from adapter-db to Core](./45-domain-types-in-core.md) | 🔲 To Do | 🔴 Critical |
| 46  | [Split translate-mode.helper.ts God Module](./46-split-translate-mode-helper.md) | 🔲 To Do | 🟠 High |
| 47  | [Wire Rate Limiting into Translation Flow](./47-wire-rate-limiting.md) | ✅ Done | ✅ Done |
| 48  | [Extract Notification Scheduler to Separate Process](./48-extract-notification-scheduler-process.md) | 🔲 To Do | 🟠 High |
| 49  | [Centralize Adapter Configuration](./49-centralize-adapter-config.md) | 🔲 To Do | 🟡 Medium |
| 50  | [SRS Schema Foundation](./50-srs-schema-foundation.md) | ✅ Done | ✅ Done |
| 51  | [Modular Bot Feature Registration](./51-modular-bot-registration.md) | 🔲 To Do | 🟡 Medium |
| 52  | [Wire Topic Cache + Normalize FK](./52-topic-cache-fk-normalization.md) | 🔲 To Do | 🟡 Medium |
| 53  | [Decouple Adapters from @polyglot/infra](./53-decouple-adapters-from-infra.md) | ✅ Done | ✅ Done |
| 54  | [Fix Core Barrel Export Conflicts](./54-fix-barrel-export-conflicts.md) | 🔲 To Do | 🟡 Medium |
| 55  | [Health Check & Basic Observability](./55-health-check-and-observability.md) | 🔲 To Do | 🟡 Medium |
| 56  | [Docker Compose Build](./56-docker-compose-build.md) | ✅ Done (files in `deploy/`) | ✅ Done |

## Finished

| #   | Task                                              |
| --- | ------------------------------------------------- |
| 01  | [Init project with monorepo](./finished/01-init-monorepo.md) |
| 02  | [Create DB schemas and push to DB](./finished/02-db-schemas.md) |
| 03  | [First step on bot creation](./finished/03-bot-setup.md) |
| 04  | [AI Translation Pipeline](./finished/04-ai-translation-pipeline.md) |
| 05  | [Structured Logging](./finished/05-logging.md) |
| 07  | [Partial Translation Regeneration](./finished/07-partial-regeneration.md) |
| 09  | [Translation Session Loop](./finished/09-translate-session-loop.md) |
| 10  | [Idiomatic & Proverb Equivalent Matching](./finished/10-idiomatic-equivalents.md) |
| 12  | [Detect Literal vs Idiomatic Translation Nuances](./finished/12-idiom-analysis.md) |
| 13  | [Wiktionary JSONL Integration](./finished/13-wiktionary-jsonl.md) |
| 15  | [Context Enrichment Layer](./finished/15-context-enrichment-layer.md) |
| 16  | [Auto-Detect Input Language](./finished/16-auto-detect-input-language.md) |
| 17  | [Post-Translation Language Selection Menu](./finished/17-next-translation-language-menu.md) |
| 19  | [Fix Translate Mode Loss](./finished/19-fix-translate-mode-persistence.md) |
| 20  | [Persist activeMode in DB](./finished/20-persist-active-mode.md) |
| 21  | [Translation Output Config](./finished/21-translation-output-config.md) |
| 23  | [Link translation_requests to languages](./finished/23-link-translation-requests-to-languages.md) |
| 25  | [Language Emoji Flag in Translation Card](./finished/25-language-flag-in-translation-card.md) |
| 30  | [Save to Dictionary](./finished/30-save-to-dictionary.md) |
| 28  | [Validation Respects Output Config](./finished/28-validation-respects-output-config.md) |
| 31  | [Redesign Translation Card](./finished/31-redesign-translation-card.md) |
| 32  | [User Translation Template](./finished/32-user-translation-template.md) |
| 22  | [Dependency Cruiser](./finished/22-dependency-cruiser.md) |
| 27  | [Input Type Detection & Text Limits](./finished/27-input-type-detection-and-text-limits.md) |
| 36  | [Persist Source Language & Re-entry Reminder](./finished/36-persist-source-lang-and-reentry-reminder.md) |
| 33  | [Config-Driven Dictionary Word Pipeline + Flash Cards](./finished/33-dictionary-word-pipeline-and-flashcards.md) |
| 39  | [Normalize Vocabulary Schema](./finished/39-normalize-vocabulary-schema.md) |
| 40  | [Dictionary Browse & Delete](./finished/40-dictionary-browse-and-delete.md) |
| 37b | [Implement /settings Command](./finished/37-implement-settings-command.md) |
| 41  | [Daily Word Notifications](./finished/41-daily-word-notifications.md) |
