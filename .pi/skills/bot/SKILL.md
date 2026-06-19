---
name: bot
description: Telegram bot using grammY with conversations plugin. Manages scenes (onboarding, translate, dictionary, settings), commands, middleware, and renders AI responses. Use when implementing or modifying bot commands, scenes, middleware, or Telegram UI.
---

# bot Agent Skill

## Module Location

`apps/bot/src/`

## Architecture Context

- **Layer:** App (top-level, Telegram-specific)
- **Dependencies:** `i18n`, `db`, `translation`, `topics`, `notifications` agents
- **Dependents:** None — this is the entry point

## Current State

Already implemented:
- `index.ts` — grammY bot setup, session middleware (default mode: "translate"), mode router, callback handlers, graceful shutdown
- `types.ts` — BotContext, ConversationContext, UserMode, SessionData (with activeMode field, DB-persisted; needsTranslateReminder flag — Task 36)
- `constants.ts` — LANGUAGES display data, langDisplay() (no business text — all i18n via core)
- `middlewares/auth.ts` — resolves/creates user, attaches to ctx.user; hydrates session activeMode from DB for onboarded users (Task 20)
- `middlewares/mode-router.ts` — routes plain text to active mode handler; idle mode falls back to translate for onboarded users (persisted to DB), shows /start hint for non-onboarded; debug logging for mode routing
- `commands/start.ts` — /start handler (onboarding or main menu); restores translate mode for onboarded users (persisted to DB)
- `scenes/onboarding.scene.ts` — 3-step onboarding conversation (BRD §5); infers interface language from native language; sets activeMode = "translate" on completion (persisted to DB)
- `scenes/translate.scene.ts` — mode-based: /translate sets mode and shows confirmation (persisted to DB)
- `scenes/helpers/translate-mode.helper.ts` — handles translation text, Save/Skip callbacks with FEAT-30 flow (FK resolution, dedup detection via `vocabularyRepository`, save via `toVocabularyInput()` + `vocabularyRepository.create()`); checks subscription-plan translation credits before incoming user translation requests; logs successful incoming translations to `translationRequestRepository`; regen updates single language row via `vocabularyRepository.updateTranslation()` and is not user-metered; uses `translateWithContext()` from context-enrichment layer
- `scenes/helpers/regen.helper.ts` — regeneration loop helper (per-language regen, save with `vocabularyRepository.create()` + `toVocabularyInput()`, skip)
- `renderers/translation.renderer.ts` — renderTranslation (HTML, template-aware), renderTopicWord (HTML), buildTranslationKeyboard (inline keyboard with inputType-aware save labels), buildPostSaveKeyboard (regen-only post-save keyboard), buildSourceLangKeyboard (source language selection keyboard)
- `scenes/template.scene.ts` — /template command handler (shows current template status with Customize/Reset buttons)
- `scenes/helpers/template.helper.ts` — Template wizard callback handlers (customize, toggle, preview, save, cancel, reset)
- `scenes/template-preview.data.ts` — Mock translation output for wizard preview
- `scenes/flashcard.scene.ts` — /flashcard command handler (Task 33); runs dictionary pipeline with FLASHCARD_CONFIG, stores deck in session
- `scenes/helpers/flashcard.helper.ts` — Flash card callback handlers (fc:start/reveal/next/done/restart/quit/close); wires pipeline deps to DB repositories; best-effort review logging
- `renderers/flashcard.renderer.ts` — renderFlashCardFront, renderFlashCardBack, buildFlashCardFrontKeyboard, buildFlashCardBackKeyboard, buildFlashCardDoneKeyboard
- `renderers/source-usage.renderer.ts` — shared source-language guidance block renderer used by flashcard, dictionary, and SRS views
- Translation, flashcard, dictionary, and SRS renderers show regular per-target `usageNote` with `💡`, separately from exceptional `connotationWarning`.

- `notifications/notification.formatter.ts` — formatNotificationMessage (HTML), buildNotificationKeyboard (Open dictionary / Skip)
- `notifications/notification.callbacks.ts` — notif:open (deep-link to /dictionary), notif:skip (dismiss)
- `notifications/notification.wiring.ts` — wireNotificationScheduler (bridges bot to notification adapter), re-exports stopScheduler

Still needed:
- (none — all core scenes implemented)

### Daily Word Notifications (Task 41)

Notification scheduler wiring, message formatting, and settings UI for daily word notifications.

**Scheduler wiring** (`notification.wiring.ts`):
1. `wireNotificationScheduler(api)` — called in `main()` after language cache is loaded
2. Creates `NotificationServiceDeps` with topic service, vocabulary, review counts, language cache
3. Creates `sendFn` — looks up user interface language, builds keyboard, sends HTML message via `bot.api.sendMessage()`
4. Creates `reEngagementSendFn` — sends plain text re-engagement messages
5. Builds `SchedulerDeps` with notification/user repos, word pickers, i18n
6. Calls `startScheduler(sendFn, reEngagementSendFn, schedulerDeps)` from `@polyglot/adapter-notifications`
7. `stopScheduler()` called in graceful shutdown

**Notification message** (`notification.formatter.ts`):
- `formatNotificationMessage(payload, lang)` — renders emoji + bold original, source label (dictionary vs AI), translations with flag emojis
- `buildNotificationKeyboard(lang)` — "📖 Open dictionary" (`notif:open`) + "⏭ Skip" (`notif:skip`)

**Notification callbacks** (`notification.callbacks.ts`):
- `notif:open` → removes keyboard, sends `/dictionary` deep-link
- `notif:skip` → removes keyboard

**Settings notification UI** (`settings.scene.ts` + `settings.helper.ts`):
- Settings menu shows 🔔 Notifications section below language settings
- Toggle button: `set:notif:toggle` — enables/disables notifications
- When enabled, shows additional buttons:
  - `set:notif:time` → picker (Morning 8:00 / Evening 20:00)
  - `set:notif:type` → picker (Dictionary SRS / AI suggestions / Both)
  - `set:notif:tz` → picker (10 common timezones, validated via `Intl.DateTimeFormat`)
- All preferences persisted via `userRepository.updateNotificationPrefs()`

**Auth middleware — last interaction tracking** (`auth.ts`):
- Fire-and-forget `userRepository.updateLastInteraction(userId)` on every request for onboarded users
- Never blocks request processing — errors logged but swallowed

**Callback data format**: Notification callbacks use `notif:` prefix: `notif:open`, `notif:skip`. Settings notification callbacks use `set:notif:` prefix: `set:notif:toggle`, `set:notif:time`, `set:notif:time:{slot}`, `set:notif:type`, `set:notif:type:{type}`, `set:notif:tz`, `set:notif:tz:{timezone}`.

**i18n keys used**: `notifTitle`, `notifWordFromDict`, `notifAiSuggested`, `notifTranslations`, `notifOpenDict`, `notifSkip`, `settingsNotifSection`, `settingsNotifEnabled`, `settingsNotifDisabled`, `settingsNotifTime`, `settingsNotifType`, `settingsNotifTimezone`, `settingsNotifToggle`, `settingsNotifChooseTime`, `settingsNotifChooseType`, `settingsNotifChooseTimezone`, `notifPaused`, `notifReEngagement`.

### Flash Card Session (Task 33)

The `/flashcard` command starts a flash card session using the config-driven dictionary pipeline:

1. **Command**: `/flashcard` → runs `createDictionaryPipeline(deps).run(userId, FLASHCARD_CONFIG)` to get 10 random words from the user's personal dictionary
2. **Empty check**: If dictionary is empty → replies with `flashcardEmpty` i18n key
3. **Session state**: `SessionData.flashcard` stores `deck: WordDisplayData[]`, `currentIndex`, `cardMsgId`, `config`
4. **Start button**: Shows deck size with `[▶️ Start]` button (`fc:start`)
5. **Card front** (`fc:start`, `fc:next`): Shows emoji + original word + input type + source language flag
6. **Reveal** (`fc:reveal`): Edits message to show back — all translations with transcription, register, synonyms, examples
7. **Next** (`fc:next`): Logs review (best-effort), advances index, shows next card front
8. **Last card**: Back keyboard shows `[🎉 Done!]` + `[🔄 Restart]` instead of Next/Quit
9. **Done** (`fc:done`): Logs review, shows completion message with count, `[🔄 New Deck]` + `[✕ Close]`
10. **Restart** (`fc:restart`): Re-runs pipeline for fresh random deck
11. **Quit** (`fc:quit`): Logs review if cards were viewed, clears session, shows quit message
12. **Close** (`fc:close`): Deletes the card message, clears session
13. **Session expired**: All callbacks check `ctx.session.flashcard` — if missing, shows `flashcardSessionExpired` via `answerCallbackQuery`
14. **Review logging**: `wordReviewRepository.logReview()` is fire-and-forget with `.catch()` — never blocks UX
15. **Pipeline deps wiring**: `flashcard.helper.ts` creates `DictionaryPipelineDeps` using `vocabularyRepository.findByUserWithSourceLang()` and `wordReviewRepository.getReviewCounts()`, resolves language IDs to codes via `getAllLangs()` cache

**Callback data format**: All flashcard callbacks use `fc:` prefix: `fc:start`, `fc:reveal`, `fc:next`, `fc:done`, `fc:restart`, `fc:quit`, `fc:close`.

### User Settings (Task 37)

The `/settings` command shows current language configuration with inline buttons to change each setting:

1. **Command**: `/settings` → shows settings menu with current native, learning, interface language configuration, subscription plan, and remaining daily translation credits
2. **Native language** (`set:native`): Opens language picker → `set:native:{code}` selects → `userRepository.updateNativeLang()` persists
3. **Learning languages** (`set:learning`): Opens multi-select → `set:learn:{code}` toggles → `userRepository.updateLearningLangs()` persists on each toggle. `set:learn:done` returns to menu. Enforces 1–4 language limit (MAX_LEARNING_LANGS).
4. **Interface language** (`set:interface`): Opens language picker → `set:iface:{code}` selects → `userRepository.updateInterfaceLang()` persists → `setUserCommands()` updates bot command menu for new language
5. **Back** (`set:back`): Returns to settings main menu from any picker
6. **Close** (`set:close`): Deletes the settings message (falls back to removing keyboard if message too old)
7. **All text** respects the current interface language via i18n
8. **After each change**, settings menu re-renders with updated values

**Callback data format**: All settings callbacks use `set:` prefix: `set:native`, `set:native:{code}`, `set:learning`, `set:learn:{code}`, `set:learn:done`, `set:interface`, `set:iface:{code}`, `set:back`, `set:close`.

**i18n keys**: `settingsTitle`, `settingsNativeLang` (with `{lang}`), `settingsLearningLangs` (with `{langs}`), `settingsInterfaceLang` (with `{lang}`), `settingsChangeNative`, `settingsChangeLearning`, `settingsChangeInterface`, `settingsClose`, `settingsChooseNative`, `settingsChooseLearning`, `settingsChooseInterface`, `settingsNativeUpdated` (with `{lang}`), `settingsLearningUpdated`, `settingsInterfaceUpdated` (with `{lang}`), `settingsSessionExpired`.

### Localized Bot Command Descriptions (Task 35)

The bot's `/` command menu now shows descriptions in the user's language:

1. **At startup** — `setBotCommands(api)` calls `setMyCommands` for each locale with a file (en, ru, cs) using the `language_code` parameter, plus a default English fallback for unsupported locales.
2. **Per-user override** — `setUserCommands(api, chatId, lang)` calls `setMyCommands` with `BotCommandScopeChat` to override the command menu for a specific user. Called after onboarding completes.
3. **On language change** — `setUserCommands()` is called after the user changes their interface language in the settings scene.
4. **Error resilience** — All `setMyCommands` calls are wrapped in try/catch; failures are logged but never crash the bot or block startup.

**Helper:** `getLocalizedCommands(lang)` returns the 5 commands with descriptions from i18n keys (`cmdDescStart`, `cmdDescTranslate`, `cmdDescDictionary`, `cmdDescTemplate`, `cmdDescSettings`).

### Always-On Translation (Task 19)

Translation is always active for onboarded users. Multiple layers ensure no text message is silently dropped:
1. **Default session mode** is `"translate"` (not `"idle"`) — new/restarted sessions start translating
2. **Onboarding completion** sets `activeMode = "translate"` — freshly onboarded users can immediately send words
3. **`/start` for returning users** restores `activeMode = "translate"` — recovers after bot restart
4. **Idle mode fallback** in mode router: onboarded users get translated (with warn log), non-onboarded users get `/start` hint
5. **Debug logging** in mode router: logs `{ mode, text, userId }` on every routed message

### Translation Output Config Presets (Task 21, updated by Task 32)

Bot callers use `resolveOutputConfig()` from `@polyglot/core` to determine which sections appear in AI translation responses. For words/phrases, the user's custom template (from DB) is used when available; otherwise the reliable default template is used (translation text + transcription only). For sentences, `SENTENCE_OUTPUT` is always used regardless of template.

**Caller → preset mapping:**

| Caller | Preset | Rationale |
|---|---|---|
| `translate-mode.helper.ts` (`handleTranslateText`, word/phrase) | User template or reliable default (via `resolveOutputConfig`) | Cheap-model reliable by default, user-customized when saved |
| `translate-mode.helper.ts` (`handleTranslateText`, sentence) | `SENTENCE_OUTPUT` (via `resolveOutputConfig`) | Sentence translation — compact, no learning metadata |
| `translate-mode.helper.ts` (`handleRegenCallback`, word/phrase) | User template or reliable default (via `resolveOutputConfig`) | Regeneration matches initial detail level |
| `translate-mode.helper.ts` (`handleRegenCallback`, sentence) | `SENTENCE_OUTPUT` (via `resolveOutputConfig`) | Sentence regen — compact output |
| `regen.helper.ts` (`handleRegenLoop`, word/phrase) | User template or reliable default (via `resolveOutputConfig`) | Conversation-based regen matches initial detail level |
| `regen.helper.ts` (`handleRegenLoop`, sentence) | `SENTENCE_OUTPUT` (via `resolveOutputConfig`) | Conversation-based regen — compact |

All callers use `resolveOutputConfig()` from `@polyglot/core` (Task 32) instead of importing named presets directly. This routes through the user's custom template when one is saved, otherwise through reliable default fields. Sentences always use `SENTENCE_OUTPUT` regardless of user template.

### Persistent activeMode in Database (Task 20)

The user's `activeMode` is now persisted in the `userLanguageSettings.activeMode` DB column so it survives bot restarts. The session is hydrated from DB on every request via the auth middleware.

**Read path:** Auth middleware loads settings for onboarded users → sets `ctx.session.activeMode` from DB value → validates against known modes (falls back to `"translate"` for unknown values).

**Write path:** Every mode change writes to both session AND DB simultaneously:
- `/start` for onboarded users → `updateActiveMode(userId, "translate")`
- `/translate` command → `updateActiveMode(userId, "translate")`
- Onboarding completion → `updateActiveMode(userId, "translate")` via `conversation.external()`
- Mode router idle→translate fallback → `updateActiveMode(userId, "translate")`

**Forward compatibility:** The `VALID_MODES` set in auth.ts and the `UserMode` type will be extended when "mentor" and "quiz" modes are implemented. Unknown DB values gracefully fall back to "translate".

### Persist Source Language & Re-entry Reminder (Task 36)

Source language selection is now persisted to DB and hydrated on bot restart. A non-blocking reminder menu is shown when returning to translate mode.

**Persistence (fire-and-forget):** When user taps a source language button (`tr:srclang:{code}`), `handleSourceLangCallback()` writes to both `ctx.session.nextSourceLang` AND `userRepository.updateLastSourceLang(userId, code)` (fire-and-forget with `.catch()` error logging). Only explicit user selections are persisted — auto-detected languages are NOT saved.

**Lazy hydration:** In `handleTranslateText()`, when `ctx.session.nextSourceLang` is null, the function checks `settings.lastSourceLang` from DB. If valid (passes `resolveDirectionFromSource()`), it's hydrated into the session. If invalid (language removed from config), both session and DB are cleared.

**Re-entry reminder:** `SessionData.needsTranslateReminder?: boolean` — set to `true` on fresh session (init), `/start`, and `/template`. When `true` and `nextSourceLang` is set, `handleTranslateText()` shows `sendSourceLangMenu()` before translating (non-blocking — translation proceeds immediately). Cleared after showing once. `/translate` command always shows the menu and clears the flag.

**Onboarding:** `updateSettings()` is called with `lastSourceLang: null` on step 2 completion, clearing any previously stored source lang. Session `nextSourceLang` is also cleared.

**Session additions:**
- `needsTranslateReminder?: boolean` — ephemeral flag, defaults to `true` in session init

**Exported function:**
- `sendSourceLangMenu(ctx, settings, lang)` — now exported from `translate-mode.helper.ts` for use by `translate.scene.ts`

### Post-Translation Source Language Selection Menu (Task 17)

After Save/Skip in translate mode, an inline keyboard menu is shown with buttons for each configured language (native + learning langs). The user can tap a button to set the source language for the next translation, bypassing auto-detection. Key implementation details:

- **Session state**: `SessionData.nextSourceLang?: string | null` — stores the explicit source language selection
- **Keyboard builder**: `buildSourceLangKeyboard(langs, currentSelection)` in `translation.renderer.ts` — renders language buttons with `tr:srclang:{code}` callback data, marks selected with ✓, returns null when user has ≤2 languages
- **Callback handler**: `handleSourceLangCallback(ctx)` in `translate-mode.helper.ts` — parses callback, sets session, answers with confirmation, updates keyboard in-place
- **Translation integration**: `handleTranslateText()` checks `nextSourceLang` first; if set, uses `resolveDirectionFromSource()` instead of auto-detect; validates against current config, resets if invalid
- **Menu suppression**: Not shown when user has only 1 native + 1 learning language (auto-detect sufficient)
- **i18n keys**: `nextTranslationFrom` (header), `nextSourceSet` (confirmation with `{lang}` param)

### Input Type Classification & Sentence Translation (Task 27)

The translate-mode helper now classifies user input as `word`, `phrase`, or `sentence` using `classifyInput()` from `apps/bot/src/utils/classify-input.ts`. Classification is based on word count (default thresholds: ≤2 → word, ≤6 → phrase, >6 → sentence). Punctuation is metadata only — NOT a hard classifier.

**Sentence behavior** differs from word/phrase in every layer:
- **Output preset:** `SENTENCE_OUTPUT` (no synonyms, alternatives, examples, equivalent note)
- **Dictionary context:** Skipped (no Wiktionary lookup for sentences)
- **Rendering:** `renderSentenceTranslation()` — compact card: emoji, original, per-language text + transcription only. No synonyms, examples, alternatives.
- **Validation:** Plain text is trimmed and rejected before AI calls when empty, emoji-only, command-like, digits-only, or longer than 500 characters. Sentences up to 500 characters remain translatable but are not saveable.
- **Keyboard:** `buildSentenceKeyboard()` — regen buttons only, no Save/Skip
- **Session:** No `pendingTranslation` stored for sentences (nothing to save to dictionary)
- **Regen:** Uses `SENTENCE_OUTPUT` preset and sentence keyboard. Reads `lastTranslation` + `lastInputType` from session.
- **i18n:** `sentenceTranslation` label prepended to card

**Session additions:**
- `lastTranslation?: TranslateOutput` — last translation output (for regen, both words and sentences)
- `lastInputType?: InputType` — input classification of last translation

**Callback handler:** `handleRegenCallback()` registered for `tr:regen:*` pattern. Handles regeneration in persistent translate mode for both word/phrase and sentence inputs.

### Save to Dictionary — FEAT-30 (updated by Task 39)

The translate-mode save flow implements the full FEAT-30 pipeline: FK resolution, duplicate detection, normalized vocabulary mapping, and in-place card editing. **Task 39** replaced the monolithic `wordRepository` + `sanitizeForStorage()` approach with the normalized `vocabularyRepository` + `toVocabularyInput()`.

**Save flow (handleSaveCallback):**
1. FK resolution: `getLang(sourceLang)` from language cache → `sourceLangId`
2. Duplicate detection: `vocabularyRepository.findByOriginalAndSource(userId, original, sourceLangId)` → if exists, show "already saved" toast and return
3. Map to normalized input: `toVocabularyInput(output, sourceLangId, inputType, langResolver)` builds `CreateVocabularyInput` with parent + per-language children
4. Persist: `vocabularyRepository.create(userId, vocabInput)` — transactional insert of `vocabulary_entries` + N `vocabulary_translations` rows, including saved `sourceUsage` on the parent entry
5. Session: set `savedWordId`, clear `pendingTranslation` and `pendingCardMsgId`
6. Edit card in-place: render with `savedToDict` text + `buildPostSaveKeyboard()` (regen-only)

**Post-save regen (handleRegenCallback):**
When `savedWordId` is set, regen auto-updates only the single regenerated language row via `vocabularyRepository.updateTranslation(entryId, targetLangId, data)` (no longer rewrites the full blob). Card shows `savedToDict` text + `buildPostSaveKeyboard()`. `savedWordId` persists across regens.

**Session additions:**
- `savedWordId?: number` — set after successful save, enables auto-update on regen, cleared on new translation

**Keyboard changes:**
- `buildTranslationKeyboard(langCodes, inputType, interfaceLang)` — contextual save label: `saveWord` for words, `savePhrase` for phrases
- `buildPostSaveKeyboard(langCodes, interfaceLang)` — regen buttons only, no Save/Skip

**Utility:**
- `toVocabularyInput(output, sourceLangId, inputType, langResolver): CreateVocabularyInput` in `apps/bot/src/utils/vocabulary-mapper.ts` — maps `TranslateOutput` → normalized `CreateVocabularyInput` (Task 39, replaces `sanitizeForStorage`)
- `sanitizeForStorage()` — **deleted in Task 40** (superseded by `toVocabularyInput()` in `vocabulary-mapper.ts`)

### Auto-Detect Input Language (Task 16)

The translate-mode helper now uses `resolveTranslationDirection()` from `@polyglot/core` to automatically detect the input language and adjust the translation direction:
- Input in native language → translates to all learning languages (unchanged behavior)
- Input in a learning language → translates to native + remaining learning languages (reversed direction)
- Ambiguous/unknown input → falls back to native→learning (safe default)

When the detected language differs from the native language (reversed direction), a `🔍 Detected: {lang}` indicator is prepended to the translation card using `getLanguageName()` for localized display names and the `detectedLang` i18n key.

### User Translation Template Constructor (Task 32)

Users can customize which fields appear in their translation output via `/template` command. The wizard uses inline keyboard toggles for 6 fields: transcription, synonyms, examples, alternatives, equivalentNote, connotationWarning.

**Session state**: `SessionData.templateWizard?: { fields: TemplateFields; wizardMsgId?: number }` — working copy during editing

**Command & callbacks:**
- `/template` → shows current template status (Default or Custom) with [📝 Customize] [🔄 Reset] buttons
- `tpl:customize` → initializes wizard with current fields, shows toggle keyboard
- `tpl:toggle:<key>` → toggles the field ✅↔❌, re-renders keyboard
- `tpl:preview` → renders mock translation card respecting current field toggles
- `tpl:save` → persists to DB via `translationTemplateRepository.upsert()`, clears wizard
- `tpl:cancel` → discards changes, clears wizard
- `tpl:reset` → deletes custom template from DB, restores default
- `tpl:back` → returns from preview to constructor

**Template-aware rendering**: `renderTranslation(output, lang, templateFields?)` accepts optional `TemplateFields`. When provided, disabled fields are omitted from the card. When undefined, all sections render (backward compat).

**Pipeline integration**: `handleTranslateText()` and `handleRegenCallback()` load the user's template via `translationTemplateRepository.getByUserId()`, then use `resolveOutputConfig()` (sentences → SENTENCE_OUTPUT, words/phrases → user template or default) and pass `effectiveTemplate.fields` to the renderer.

**i18n keys**: `templateTitle`, `templateCurrent` (with `{name}`), `templateDefault`, `templateCustom`, `templateCustomize`, `templateReset`, `templateConstructor`, `templatePreview`, `templateSave`, `templateCancel`, `templateBack`, `templateSaved`, `templateResetDone`, `templateCancelled`, `templateField*` (6 field labels), `templatePreviewHeader`, `templateSessionExpired`.

### Dictionary Browse & Delete (Task 40)

The `/dictionary` command shows the user's personal dictionary as a paginated list (15 words per page) with inline navigation, entry detail view, and delete functionality.

1. **Command**: `/dictionary` → calls `vocabularyRepository.countByUser()` + `findByUserPaginated()` to get the first page
2. **Empty check**: If dictionary is empty → replies with `emptyDictionary` i18n key
3. **Session state**: `SessionData.dictionary` stores `currentPage` and `msgId`
4. **List view**: Shows emoji + bold original + up to 2 translation summaries per entry. Long words truncated to 30 chars. Global indexing (page 2 starts at 16).
5. **Navigation**: `[◀️ Prev] [page/total] [▶️ Next]` — prev hidden on page 1, next hidden on last page, entire row hidden when 1 page
6. **Entry buttons**: One button per entry with `dict:view:{entryId}` callback
7. **Entry detail** (`dict:view:{entryId}` or `dict:view:{entryId}:{page}`): Shows full translation card — emoji, original, input type + source flag, per-language translations with transcription, register, synonyms, examples
8. **Delete flow** (`dict:delete:{entryId}`): Shows confirmation with word name → `dict:confirm-delete:{entryId}:{page}` → calls `vocabularyRepository.hardDelete()`, refreshes list
9. **Edge cases**: Auto-navigate to previous page when current page empties after delete; show `emptyDictionary` when last word deleted; session expiry shows `dictionarySessionExpired`
10. **Close** (`dict:close`): Deletes the message, clears session
11. **Noop** (`dict:noop`): Page indicator button — no action

**Callback data format**: All dictionary callbacks use `dict:` prefix: `dict:page:{n}`, `dict:view:{entryId}`, `dict:view:{entryId}:{page}`, `dict:delete:{entryId}`, `dict:confirm-delete:{entryId}:{page}`, `dict:close`, `dict:noop`.

**Renderer**: `apps/bot/src/renderers/dictionary.renderer.ts` — `renderDictionaryList()`, `renderDictionaryEntry()`, `buildDictionaryListKeyboard()`, `buildDictionaryEntryKeyboard()`, `buildDeleteConfirmKeyboard()`. Exports `DICTIONARY_PAGE_SIZE = 15`.

**Deprecated file cleanup (Task 40 T5 bot part)**: `apps/bot/src/utils/sanitize-word-content.ts` and its test deleted — superseded by `vocabulary-mapper.ts`.

### Async Lite AI Validation (Task 37)

After every translation card is sent (both word/phrase and sentence), the bot fires `fireAsyncValidation()` from `apps/bot/src/utils/async-validation.ts`. This is a fire-and-forget bridge that:

1. Reads `AI_MODEL_VALIDATOR` from `process.env` — if absent, validation is disabled (feature toggle)
2. Dynamically imports `triggerAsyncValidation` from `@polyglot/core` — if not yet exported from core's public API, gracefully skips
3. Delegates risk detection and validation to the core lite-ai module
4. On flagged translations: logs a warning (DB `markForReview()` pending 37.6 implementation)
5. Extracts `expressionTypes` from `output.translations` for risk detection
6. Never throws — all errors caught and logged

**Rendering**: The renderer already shows `translationNeedsReview` for immediate output validation flags. A new `renderQualityWarning(interfaceLang)` function uses the `qualityUncertain` i18n key for DB-flagged words — ready for dictionary/flashcard views when implemented.

**Wiring location**: `handleTranslateText()` in `translate-mode.helper.ts` calls `fireAsyncValidation()` after the translation card is sent in both the sentence and word/phrase branches. No change to user-visible response timing.

**Pending upstream dependencies** (tracked in respective agents):
- Core package needs to export `triggerAsyncValidation` and types from main index
- Infra config needs `AI_MODEL_VALIDATOR` field in env schema
- DB adapter needs `vocabularyRepository.markForReview()` method and `needs_review` column

## Boundary

- **Mode:** role — when this skill is active, you ARE the bot agent. Only modify the Telegram bot layer.
- **Produces:** bot source code and tests in `apps/bot/src/`
- **Never:** modify code outside `apps/bot/src/`
- **Never:** contain business logic, direct DB access, or hardcoded strings
- **Never:** modify core packages (`packages/core/`) or adapter packages (`packages/adapters/`)
- **Allowed tools:** `read`, `bash`, `edit`, `write`
- **Allowed write paths:** `apps/bot/src/**`

## Rules

1. Never contains business logic — only calls to other agents
2. Never accesses the DB directly — only through the `db` agent (repositories)
3. All texts only through the `i18n` agent — no hardcoded strings
4. Each scene is a separate file, max 100 lines

## Bot Commands

| Command       | Description                       |
| ------------- | --------------------------------- |
| `/start`      | Onboarding or main menu           |
| `/translate`  | Translate a word or phrase        |
| `/flashcard`  | Start a flash card session        |
| `/template`   | Customize translation output      |
| `/dictionary` | Personal dictionary               |
| `/settings`   | Language, notifications, timezone |

## Skills (Public API / Key Functions)

```typescript
// Get 6 bot commands with localized descriptions (Task 35 + Task 33)
function getLocalizedCommands(lang: SupportedLang): BotCommand[];

// Set bot commands for all available locales at startup (Task 35)
// Sets default English fallback + per-locale commands for en, ru, cs
async function setBotCommands(api: Api<RawApi>): Promise<void>;

// Set commands for a specific user chat using BotCommandScopeChat (Task 35)
// Called after onboarding or when user changes interface language
async function setUserCommands(api: Api<RawApi>, chatId: number, lang: SupportedLang): Promise<void>;

// Render a full translation card for Telegram (HTML)
// Dictionary context (if present) is NOT rendered — used only for AI prompt enrichment
// Optional templateFields controls which sections are rendered (Task 32)
function renderTranslation(output: TranslateOutput, interfaceLang?: string, templateFields?: TemplateFields, nativeLang?: string): string;

// Render a single topic word card (HTML)
function renderTopicWord(word: TopicWord): string;

// Build inline keyboard with per-language regenerate buttons + contextual save/skip
function buildTranslationKeyboard(langCodes: string[], inputType: 'word' | 'phrase', interfaceLang?: string): InlineKeyboard;

// Build post-save keyboard — regen buttons only, no Save/Skip (FEAT-30)
function buildPostSaveKeyboard(langCodes: string[], interfaceLang?: string): InlineKeyboard;

// Map TranslateOutput → CreateVocabularyInput for normalized vocabulary storage (Task 39)
// Lives in bot layer because it bridges core's TranslateOutput and adapter-db's CreateVocabularyInput
function toVocabularyInput(output: TranslateOutput, sourceLangId: number, inputType: "word" | "phrase", langResolver: LangResolver): CreateVocabularyInput;

// Type: resolves language code to DB ID
type LangResolver = (code: string) => number | null;


// Render a compact sentence translation card (Task 27)
// No synonyms, examples, alternatives — just text + transcription
function renderSentenceTranslation(output: TranslateOutput, interfaceLang?: string, nativeLang?: string): string;

// Build inline keyboard for sentences — regen only, no Save/Skip (Task 27)
function buildSentenceKeyboard(langCodes: string[], interfaceLang?: string): InlineKeyboard;

// Render quality warning for DB-flagged words — uses qualityUncertain i18n key (Task 37)
function renderQualityWarning(interfaceLang?: string): string;

// Fire-and-forget async lite AI validation trigger (Task 37)
// Feature-flagged via AI_MODEL_VALIDATOR env var
function fireAsyncValidation(params: FireAsyncValidationParams): void;

// Scene: 3-step onboarding (BUG-01 fix — BRD §5)
async function onboarding(conversation, ctx): Promise<void>;

// Command: /translate — sets mode and shows confirmation
async function handleTranslateCommand(ctx: BotContext): Promise<void>;

// Mode handler: translate text (plain text in translate mode)
async function handleTranslateText(ctx: BotContext, word: string): Promise<void>;

// Callback: Save translation to dictionary
async function handleSaveCallback(ctx: BotContext): Promise<void>;

// Callback: Skip translation (discard)
async function handleSkipCallback(ctx: BotContext): Promise<void>;

// Callback: Regeneration in persistent translate mode (Task 27)
async function handleRegenCallback(ctx: BotContext): Promise<void>;

// Callback: Source language selection (Task 17)
async function handleSourceLangCallback(ctx: BotContext): Promise<void>;

// Build source language selection keyboard (Task 17)
// Returns null when user has ≤2 languages (auto-detect sufficient)
function buildSourceLangKeyboard(langs: LangOption[], currentSelection: string | null): InlineKeyboard | null;

// Send source language selection menu — hint text + keyboard (Task 36)
// Exported for use by /translate command. Falls back to plain hint when ≤2 languages.
async function sendSourceLangMenu(ctx: BotContext, settings: UserSettings | null, lang: SupportedLang): Promise<void>;

// Build language option list from user settings (Task 17)
function buildLangOptions(nativeLang: string, learningLangs: string[], interfaceLang: SupportedLang): LangOption[];

// Helper: regeneration loop (regen/save/skip callback handling, sentence-aware)
async function handleRegenLoop(conversation, ctx, output, lang, userId, cardMsgId, inputType?): Promise<void>;

// Classify user input as word, phrase, or sentence (Task 27)
function classifyInput(text: string, config?: Partial<InputClassifierConfig>): InputClassification;

// Command: /template — shows template status with Customize/Reset buttons (Task 32)
async function handleTemplateCommand(ctx: BotContext): Promise<void>;

// Template wizard callbacks (Task 32)
async function handleCustomizeCallback(ctx: BotContext): Promise<void>;
async function handleToggleCallback(ctx: BotContext): Promise<void>;
async function handlePreviewCallback(ctx: BotContext): Promise<void>;
async function handleSaveTemplateCallback(ctx: BotContext): Promise<void>;
async function handleCancelCallback(ctx: BotContext): Promise<void>;
async function handleResetCallback(ctx: BotContext): Promise<void>;
async function handleBackCallback(ctx: BotContext): Promise<void>;

// Command: /flashcard — start a flash card session (Task 33)
async function handleFlashcardCommand(ctx: BotContext): Promise<void>;

// Flashcard callback handlers (Task 33)
async function handleFcStart(ctx: BotContext): Promise<void>;
async function handleFcReveal(ctx: BotContext): Promise<void>;
async function handleFcNext(ctx: BotContext): Promise<void>;
async function handleFcDone(ctx: BotContext): Promise<void>;
async function handleFcRestart(ctx: BotContext): Promise<void>;
async function handleFcQuit(ctx: BotContext): Promise<void>;
async function handleFcClose(ctx: BotContext): Promise<void>;

// Render the FRONT of a flash card (original word, no translations) — Task 33
function renderFlashCardFront(word: WordDisplayData, cardIndex: number, totalCards: number, lang: SupportedLang): string;

// Render the BACK of a flash card (original + all translations) — Task 33
function renderFlashCardBack(word: WordDisplayData, cardIndex: number, totalCards: number, lang: SupportedLang): string;

// Build keyboards for flash card states — Task 33
function buildFlashCardFrontKeyboard(lang: SupportedLang): InlineKeyboard;
function buildFlashCardBackKeyboard(isLastCard: boolean, lang: SupportedLang): InlineKeyboard;
function buildFlashCardDoneKeyboard(lang: SupportedLang): InlineKeyboard;

// Scene: /dictionary command — paginated dictionary browser (Task 40)
async function handleDictionaryCommand(ctx: BotContext): Promise<void>;

// Dictionary callback handlers (Task 40)
async function handleDictPage(ctx: BotContext): Promise<void>;
async function handleDictView(ctx: BotContext): Promise<void>;
async function handleDictDelete(ctx: BotContext): Promise<void>;
async function handleDictConfirmDelete(ctx: BotContext): Promise<void>;
async function handleDictClose(ctx: BotContext): Promise<void>;
async function handleDictNoop(ctx: BotContext): Promise<void>;

// Render paginated dictionary list as HTML (Task 40)
function renderDictionaryList(entries, page, totalPages, totalWords, lang): string;

// Render single entry detail view as HTML (Task 40)
function renderDictionaryEntry(entry, langResolver, lang): string;

// Build keyboards for dictionary views (Task 40)
function buildDictionaryListKeyboard(entries, page, totalPages, lang): InlineKeyboard;
function buildDictionaryEntryKeyboard(entryId, page, lang): InlineKeyboard;
function buildDeleteConfirmKeyboard(entryId, page, lang): InlineKeyboard;

// Dictionary page size constant (Task 40)
const DICTIONARY_PAGE_SIZE = 15;

// Command: /settings — shows settings menu with current config (Task 37)
async function handleSettingsCommand(ctx: BotContext): Promise<void>;

// Build settings main menu text (exported for reuse by helper) — Task 41: notification params added
function buildSettingsText(nativeLang: string, learningLangs: string[], interfaceLang: string, lang: SupportedLang, notifEnabled?: boolean, notifTime?: string, notifType?: string, timezone?: string): string;

// Build settings main menu keyboard (exported for reuse by helper) — Task 41: notifEnabled param added
function buildSettingsKeyboard(lang: SupportedLang, notifEnabled?: boolean): InlineKeyboard;

// Settings callback handlers (Task 37)
async function handleSetNativeCallback(ctx: BotContext): Promise<void>;
async function handleSetNativeSelectCallback(ctx: BotContext): Promise<void>;
async function handleSetLearningCallback(ctx: BotContext): Promise<void>;
async function handleSetLearnToggleCallback(ctx: BotContext): Promise<void>;
async function handleSetInterfaceCallback(ctx: BotContext): Promise<void>;
async function handleSetIfaceSelectCallback(ctx: BotContext): Promise<void>;
async function handleSetBackCallback(ctx: BotContext): Promise<void>;
async function handleSetCloseCallback(ctx: BotContext): Promise<void>;

// Notification settings callback handlers (Task 41)
async function handleSetNotifToggleCallback(ctx: BotContext): Promise<void>;
async function handleSetNotifTimeCallback(ctx: BotContext): Promise<void>;
async function handleSetNotifTimeSelectCallback(ctx: BotContext): Promise<void>;
async function handleSetNotifTypeCallback(ctx: BotContext): Promise<void>;
async function handleSetNotifTypeSelectCallback(ctx: BotContext): Promise<void>;
async function handleSetNotifTzCallback(ctx: BotContext): Promise<void>;
async function handleSetNotifTzSelectCallback(ctx: BotContext): Promise<void>;

// Notification formatter (Task 41)
function formatNotificationMessage(payload: NotificationPayload, lang: SupportedLang): string;
function buildNotificationKeyboard(lang: SupportedLang): InlineKeyboard;

// Notification callback handlers (Task 41)
async function handleNotifOpenCallback(ctx: BotContext): Promise<void>;
async function handleNotifSkipCallback(ctx: BotContext): Promise<void>;

// Notification scheduler wiring (Task 41)
function wireNotificationScheduler(api: Api<RawApi>): void;
```

## Translation Flow (Persistent Mode System)

The bot uses a **persistent mode system** for translate. Once the user enters translate mode, every plain text message is automatically treated as a word to translate.

```
/translate
  ├─ Set activeMode = "translate" in session
  └─ Show confirmation: "🔤 Translate mode — send me a word or phrase to translate."

[Plain text message while in translate mode]
  ├─ Get user settings (interfaceLang, nativeLang, learningLangs)
  ├─ Resolve translation direction:
  │   ├─ If nextSourceLang set → use resolveDirectionFromSource() (explicit, no detection)
  │   ├─ If nextSourceLang invalid → reset to null, fall back to auto-detect
  │   └─ If nextSourceLang null → auto-detect via resolveTranslationDirection()
  ├─ Classify input: classifyInput(word) → word / phrase / sentence (Task 27)
  ├─ Load user template: translationTemplateRepository.getByUserId() (Task 32)
  ├─ Resolve output config: resolveOutputConfig(userTpl, classification.type)
  │   (sentences → SENTENCE_OUTPUT, words/phrases → user template or reliable DEFAULT_TEMPLATE)
  ├─ Show "Translating..." indicator
  ├─ Call translateWithContext() with resolved direction + generateObject
  │   (sentences skip dictionary lookup via no-op lookupContext)
  ├─ Store lastTranslation + lastInputType in session (for regen)
  │
  ├── word/phrase:
  │   ├─ Render full card (HTML), prepend detected lang if reversed
  │   ├─ Show Save/Skip/Regen keyboard
  │   ├─ Store pendingTranslation for Save/Skip
  │   └─ Show source language selection menu
  │
  └── sentence:
      ├─ Render compact card via renderSentenceTranslation()
      ├─ Prepend "📝 Sentence translation" label
      ├─ Show Regen-only keyboard (no Save/Skip)
      ├─ No pendingTranslation (nothing to save)
      └─ Show source language selection menu

[Save callback — FEAT-30 flow (updated Task 39)]
  ├─ FK resolution: getLang(sourceLang) → sourceLangId
  ├─ Duplicate detection: vocabularyRepository.findByOriginalAndSource()
  │   └─ If duplicate: show "already saved" toast, return early
  ├─ Map: toVocabularyInput() builds normalized CreateVocabularyInput
  ├─ Persist: vocabularyRepository.create() — transactional parent + N translations
  ├─ Session: set savedWordId, clear pendingTranslation
  └─ Edit card in-place: savedToDict text + buildPostSaveKeyboard (regen-only)

[Skip callback]
  ├─ Remove keyboard from card
  ├─ Clear pending state
  └─ Show source language selection menu (or plain hint if ≤2 langs)

[Regen callback (tr:regen:{code}) — Task 27 + FEAT-30]
  ├─ Read lastTranslation + lastInputType from session
  ├─ Load user template: translationTemplateRepository.getByUserId() (Task 32)
  ├─ Resolve output config: resolveOutputConfig(userTpl, inputType)
  │   (sentences → SENTENCE_OUTPUT, words/phrases → user template or default)
  ├─ Call translateOneWithContext() with correct preset + inputType
  ├─ Merge regenerated translation into lastTranslation
  ├─ If savedWordId set: auto-update single language row via vocabularyRepository.updateTranslation()
  ├─ For word/phrase (not yet saved): also update pendingTranslation
  └─ Re-render card: savedWordId? → postSaveKeyboard+savedToDict : translationKeyboard

[Source language selection callback (tr:srclang:{code})]
  ├─ Set ctx.session.nextSourceLang = code
  ├─ Answer with confirmation "🔤 Next from: {lang}"
  └─ Update keyboard in-place (✓ on selected button)
```

**Mode Persistence:**
- User stays in translate mode after Save/Skip
- Next plain text message triggers another translation
- Mode switches only when user sends another mode command (e.g., future `/mentor`)
- Non-mode commands (`/help`, `/settings`, `/start`) don't change the mode

## Onboarding Flow (3 Steps — BRD §5)

```
/start
  ├─ Step 1: Choose native language (inline keyboard) — interface language inferred
  ├─ Step 2: Choose learning languages (multi-select, 1–4)
  └─ Step 3: Demo translation → shows result immediately (no Save/Skip) → Complete
```

Interface language is inferred from native language (or Telegram locale as fallback). No separate interface language selection step.

## grammY Conversations Pattern

```typescript
import { Conversation } from "@grammyjs/conversations";

export async function myScene(
  conversation: Conversation<BotContext, ConversationContext>,
  ctx: ConversationContext,
): Promise<void> {
  // Use conversation.external() for side effects (DB calls, AI calls)
  const data = await conversation.external(async () => {
    return someRepository.findSomething();
  });

  // Use conversation.waitFor() for user input
  const response = await conversation.waitFor("message:text");
}
```

## Rendering

Translation results use **HTML parse mode** for safe rendering of dynamic content:
- `<b>bold</b>` for words and translations
- `<i>italic</i>` for example sentences
- HTML entities (`&amp;`, `&lt;`, `&gt;`) for escaping user/AI content

### Wiktionary Dictionary Context (Task 13)

Dictionary context (`TranslateOutput.dictionaryContext`) is **not rendered** in the user-facing Telegram card. It is used only to enrich the AI translation prompt via the context-enrichment layer. The renderer explicitly ignores the `dictionaryContext` field — tests verify no POS, glosses, or expression hints appear in the card output.

Dictionary context lookup is handled by the **context-enrichment layer** (`translateWithContext()` from `@polyglot/core`). The bot passes `createContextLookup()` from `@polyglot/adapter-db` as a dependency — the enrichment layer handles fail-open lookup, transformation to `DictionaryContext`, and merging into the translation prompt. The bot never accesses `wordContextRepository` directly.

### Language Flags in Translation Cards (Task 25)

The translation card and topic word card now display emoji flags from the DB language registry instead of a hardcoded `🔤`. Both `renderLangBlock()` and `renderTopicWord()` call `getLangFlag(code)` from `@polyglot/core` with a `?? "🔤"` fallback for languages without a flag. All 10 supported languages have flags populated in the DB (en→🇬🇧, ru→🇷🇺, cs→🇨🇿, de→🇩🇪, fr→🇫🇷, es→🇪🇸, it→🇮🇹, pt→🇵🇹, uk→🇺🇦, pl→🇵🇱).

### Translation Alternatives (Task 15)

When `LanguageTranslation.alternatives` is present and non-empty, `renderLangBlock()` renders each alternative after the main translation header and before examples:
```
🇨🇿 CS: <b>dům</b> (domov, obydlí)
   ∙ domov (neutral) — bydliště (neutral)
   ∙ stavení (literary)
💬 <i>Dům je velký.</i>  → neutrální
```
Each alternative shows its text, register, and optional synonyms inline. The `alternatives` field is optional — existing translations without it render unchanged.

### Idiomatic Equivalent Support (Task 10)

The renderer is **transparent** to idiomatic equivalent metadata. When upstream translation types include `expressionType` and `equivalentNote` fields (added in Task 10), the renderer continues to display the `text` field as before. These metadata fields are not rendered in the Telegram output — they flow through the data model without any bot-layer changes. Compatibility is verified by dedicated transparency tests.

### Redesigned Translation Card (Task 31)

The translation card was redesigned for better usability:

- **Inline synonyms**: Synonyms are shown compactly after the translation header: `🇬🇧 EN: <b>to excite</b> (syn1, syn2)` — text only, no register in parenthetical. No separate "Synonyms:" section block.
- **Register-labeled examples**: All examples use `💬` icon (no per-context icons). Each example shows the target sentence in italic with an inline register label: `💬 <i>sentence</i>  → register`. No native (source language) translation rendered — only target language.
- **Native meaning**: `TranslateOutput.nativeMeaning` is rendered directly below the original in translation and sentence cards, using dynamic language flag/code labels when `nativeLang` is known. Saved dictionary details, flashcards, SRS cards, and notifications render persisted native meaning when available.
- **Connotation warnings**: Optional informational `ℹ️` line rendered after examples when `LanguageTranslation.connotationWarning` is present. Uses i18n key `connotationWarning` with `{warning}` param.
- **Backward compatibility**: Renderer gracefully handles old example format from DB — examples without `register` field render without the `→ label` suffix; `native` field is silently ignored.
- **Card layout order**: flag + lang code + translation (+ inline synonyms) → alternatives → examples (💬 + register) → connotation warning (⚠️).

## File Structure

```
apps/bot/src/
├── index.ts                    # Bot setup, session, middleware, callbacks, start
├── types.ts                    # BotContext, ConversationContext, UserMode, SessionData
├── constants.ts                # LANGUAGES display data, langDisplay()
├── middlewares/
│   ├── auth.ts                 # Auth middleware (user resolution + activeMode hydration from DB + lastInteraction update)
│   ├── auth.test.ts            # 10 tests (user resolution, activeMode hydration, fallback, lastInteraction)
│   └── mode-router.ts          # ✅ Routes plain text to active mode handler (idle→translate fallback, DB persist)
├── commands/
│   ├── commands.ts             # ✅ getLocalizedCommands(), setBotCommands(), setUserCommands() (Task 35)
│   ├── start.ts                # /start command (restores translate mode, persists to DB)
│   └── start.test.ts           # 4 tests (activeMode restore, DB persistence, onboarding entry, no user)
├── utils/
│   ├── __tests__/
│   ├── async-validation.ts           # ✅ fireAsyncValidation() — fire-and-forget lite AI validation bridge (Task 37)
│   ├── async-validation.test.ts      # 6 tests (feature flag, dynamic import, graceful degradation)
│   ├── classify-input.ts             # ✅ Input classifier: word/phrase/sentence (Task 27)
│   ├── classify-input.test.ts        # 18 tests (classification rules, boundaries, config)
│   ├── vocabulary-mapper.ts           # ✅ toVocabularyInput() — maps TranslateOutput → CreateVocabularyInput (Task 39)
│   ├── vocabulary-mapper.test.ts     # 13 tests (field mapping, language resolution, immutability, details structure)
│   (sanitize-word-content.ts deleted in Task 40 — superseded by vocabulary-mapper.ts)
├── renderers/
│   ├── translation.renderer.ts # renderTranslation, renderSentenceTranslation, renderTopicWord, renderQualityWarning, buildTranslationKeyboard(+inputType), buildPostSaveKeyboard, buildSentenceKeyboard, buildSourceLangKeyboard
│   ├── flashcard.renderer.ts   # ✅ renderFlashCardFront, renderFlashCardBack, buildFlashCardFrontKeyboard, buildFlashCardBackKeyboard, buildFlashCardDoneKeyboard (Task 33)
│   ├── source-usage.renderer.ts # shared source-language guidance renderer
│   ├── dictionary.renderer.ts # ✅ renderDictionaryList, renderDictionaryEntry, buildDictionaryListKeyboard, buildDictionaryEntryKeyboard, buildDeleteConfirmKeyboard, DICTIONARY_PAGE_SIZE (Task 40)
│   └── __tests__/
│       ├── source-lang-menu.test.ts     # 8 tests (keyboard rendering, ✓ marks, suppression)
│       └── dictionary.renderer.test.ts  # 28 tests (list, entry, keyboards, edge cases)
├── scenes/
│   ├── onboarding.scene.ts     # ✅ 3-step onboarding (BRD §5, BUG-01 fix, infers interface lang)
│   ├── translate.scene.ts      # ✅ implemented (mode-based: sets mode + confirmation, persists to DB)
│   ├── translate.scene.test.ts # 5 tests (mode activation, DB persistence, confirmation, source lang menu, reminder flag)
│   ├── template.scene.ts       # ✅ /template command handler (Task 32)
│   ├── template-preview.data.ts # ✅ Mock translation output for wizard preview (Task 32)
│   ├── flashcard.scene.ts      # ✅ /flashcard command handler — runs pipeline, stores deck in session (Task 33)
│   ├── dictionary.scene.ts     # ✅ /dictionary command handler — counts+paginates, stores session (Task 40)
│   ├── helpers/
│   │   ├── dictionary.helper.ts      # ✅ dict:* callback handlers (page, view, delete, confirm-delete, close, noop) (Task 40)
│   │   ├── flashcard.helper.ts       # ✅ fc:* callback handlers + pipeline deps wiring (Task 33)
│   │   ├── settings.helper.ts        # ✅ set:* callback handlers (native/learning/interface/notification pickers, back, close) (Task 37 + 41)
│   │   ├── translate-mode.helper.ts  # ✅ handleTranslateText (classifier + branching + template-aware), handleRegenCallback, handleSaveCallback, handleSkipCallback, handleSourceLangCallback
│   │   ├── translate-mode.helper.test.ts # 5 tests (context enrichment wiring)
│   │   ├── __tests__/
│   │   │   ├── dictionary.helper.test.ts                 # 17 tests (callbacks, session expired, delete flow)
│   │   │   ├── translate-mode-detection.test.ts      # 8 tests (auto-detect language direction)
│   │   │   ├── translate-mode-source-lang.test.ts    # 11 tests (explicit source lang override)
│   │   │   ├── translate-mode-persist-source.test.ts # 7 tests (DB hydration, invalid clearing, fire-and-forget sync — Task 36)
│   │   │   ├── translate-mode-reminder.test.ts       # 6 tests (non-blocking reminder menu — Task 36)
│   │   │   └── source-lang-callback.test.ts          # 7 tests (callback handling)
│   │   ├── template.helper.ts        # ✅ Template wizard callbacks: customize, toggle, preview, save, cancel, reset, back (Task 32)
│   │   ├── regen.helper.ts           # ✅ regeneration loop helper (sentence-aware, vocabularyRepository save flow, template-aware)
│   │   └── regen.helper.test.ts      # 13 tests (includes dedup, FK resolution, inputType, vocabularyRepository)
│   ├── settings.scene.ts        # ✅ /settings command handler — shows current config + notifications, delegates to helpers (Task 37 + 41)
├── notifications/
│   ├── notification.formatter.ts      # ✅ formatNotificationMessage (HTML), buildNotificationKeyboard (Task 41)
│   ├── notification.formatter.test.ts # 9 tests (rendering, escaping, keyboard buttons)
│   ├── notification.callbacks.ts      # ✅ notif:open, notif:skip callback handlers (Task 41)
│   ├── notification.callbacks.test.ts # 5 tests (open deep-link, skip dismiss, error handling)
│   └── notification.wiring.ts         # ✅ wireNotificationScheduler(), re-exports stopScheduler (Task 41)
└── __tests__/
    ├── translate-mode.test.ts              # ✅ 11 tests (mode system tests, idle fallback, DB persistence)
    ├── translation.renderer.test.ts        # 95 tests (includes 7 alternatives, 5 connotation warnings, 2 backward compat, 4 inline synonyms, 15 sentence renderer, 7 sentence keyboard, 5 post-save keyboard, 6 quality warning)
    ├── translation.renderer.template.test.ts # ✅ 10 tests (template-aware rendering: field toggle, backward compat, mixed fields)
    ├── template.scene.test.ts              # ✅ 15 tests (command, customize, toggle, save, cancel, reset, preview, back)
    ├── settings.scene.test.ts             # ✅ 17 tests (command, native/learning/interface pickers, toggle, done, close, back) (Task 37)
    ├── notification-settings.test.ts      # ✅ 17 tests (notification toggle, time/type/tz pickers, settings rendering) (Task 41)
    ├── flashcard.renderer.test.ts         # ✅ 20 tests (front/back rendering, keyboards, synonyms, examples) (Task 33)
    ├── dictionary-context-renderer.test.ts # 6 tests (dict context rendering, unified expression detection)
    └── onboarding.scene.test.ts            # 18 tests (3-step flow, back nav, interface lang inference, no Save/Skip)
```

## Reference

- Onboarding spec: `docs/tech-reqs/09-onboarding.md`
- Bot commands: `docs/tech-reqs/10-bot-commands.md`
- Architecture: `docs/tech-reqs/02-architecture.md`
- Agent contracts: `docs/tech-reqs/14-agents.md` (bot section)
