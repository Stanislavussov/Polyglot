# Task 07: Partial Translation Regeneration (Per-Language)

**Status:** ✅ Done

## Description

After receiving a translation result, the user may feel that one specific language translation is incorrect or low quality while others are fine. Currently the only option is to re-translate the entire word, wasting tokens and time. This task adds **per-language regeneration buttons** below the translation card so the user can regenerate only the problematic language's part while keeping the rest intact.

**References:**
- `tech-reqs/08-ai-prompt.md` (prompt structure)
- `tech-reqs/07-ai-validation.md` (validation pipeline)
- `tech-reqs/14-agents.md` (agent contracts)

---

## User Flow

```
/translate
  ├─ User enters a word → AI translates to all learning languages (e.g. CS, DE, FR)
  ├─ Bot renders the full translation card
  ├─ Below the card: inline keyboard with per-language regenerate buttons
  │   🔄 CS  │  🔄 DE  │  🔄 FR
  │   ➕ Save to dictionary  │  ❌ No
  ├─ User taps "🔄 CS"
  │   ├─ Bot shows "⏳ Regenerating CS..." loading state
  │   ├─ AI re-translates ONLY for Czech (1 target language)
  │   ├─ Bot merges the new CS translation into the existing result
  │   ├─ Bot re-renders the full card with updated CS section
  │   └─ Keyboard is shown again (user can regenerate again or save)
  └─ User taps "Save to dictionary" → saves the final merged result
```

---

## Subtasks

### Step 1: Add a single-language `translateOne()` function to translation service

The existing `translate()` always translates to all target languages at once. We need a lightweight variant that translates to **one** language, reusing the same prompt structure but with a single target.

- [x] In `packages/core/src/modules/translation/translation.service.ts`, add:
  ```typescript
  /**
   * Re-translate a word for a single target language.
   * Returns only the LanguageTranslation for that language.
   * Used by partial regeneration — cheaper than full translate().
   */
  export async function translateOne(
    input: TranslateInput & { targetLang: string },
    generateObjectFn: GenerateObjectFn,
  ): Promise<LanguageTranslation> {
    // Call translate() with targetLangs: [input.targetLang]
    // Return output.translations[input.targetLang]
  }
  ```
  - This is a thin wrapper: calls `translate()` with `targetLangs: [targetLang]`
  - Extracts and returns just the single `LanguageTranslation` object
  - Validation pipeline runs normally (single-language is simpler → fewer false positives)
- [x] Export `translateOne` from `packages/core/src/modules/translation/index.ts`
- [x] Add tests in `packages/core/src/modules/translation/__tests__/translation.service.test.ts`:
  - Calls `translate()` with single-element `targetLangs`
  - Returns the `LanguageTranslation` for the requested language
  - Propagates errors from `translate()`

### Step 2: Add i18n keys for regeneration UI

- [x] Add new keys to `packages/core/src/modules/i18n/types.ts` (`I18nKey` type):
  ```typescript
  | "regenerateLang"       // "🔄 {lang}" — button label
  | "regenerating"         // "⏳ Regenerating {lang}..." — loading message
  | "regenerated"          // "✅ {lang} translation updated" — success toast
  ```
- [x] Add `I18nParams` entries:
  ```typescript
  regenerateLang: { lang: string };
  regenerating: { lang: string };
  regenerated: { lang: string };
  ```
- [x] Add translations to all 3 locale files:

  **en.json:**
  ```json
  "regenerateLang": "🔄 {lang}",
  "regenerating": "⏳ Regenerating {lang}...",
  "regenerated": "✅ {lang} translation updated"
  ```
  **ru.json:**
  ```json
  "regenerateLang": "🔄 {lang}",
  "regenerating": "⏳ Обновляю {lang}...",
  "regenerated": "✅ Перевод на {lang} обновлён"
  ```
  **cs.json:**
  ```json
  "regenerateLang": "🔄 {lang}",
  "regenerating": "⏳ Aktualizuji {lang}...",
  "regenerated": "✅ Překlad pro {lang} aktualizován"
  ```
- [x] Update i18n tests to cover new keys

### Step 3: Update translation renderer to support per-language rendering

The renderer currently renders the full card. We need it to also produce an inline keyboard with regeneration buttons.

- [x] In `apps/bot/src/renderers/translation.renderer.ts`, add `buildTranslationKeyboard()`
- [x] Add tests for `buildTranslationKeyboard` in `apps/bot/src/__tests__/translation.renderer.test.ts`:
  - Generates correct callback data format `tr:regen:<code>`
  - Includes all language codes
  - Has save/skip row

### Step 4: Update translate scene to handle per-language regeneration

This is the main change — the translate scene must handle `tr:regen:<langCode>` callbacks in a loop, allowing multiple regenerations before the final save/skip.

- [x] In `apps/bot/src/scenes/translate.scene.ts`, refactor the post-translation flow:

  **Key changes:**
  1. Replace the hardcoded `InlineKeyboard` with `buildTranslationKeyboard()`
  2. Change callback query pattern from `/^tr:/` to `/^tr:(save|skip|regen:.+)$/`
  3. Add a regeneration loop:

  ```typescript
  // After initial translation...
  let output: TranslateOutput = /* ... initial translation ... */;
  const langCodes = Object.keys(output.translations);

  // Build keyboard with regenerate buttons
  let keyboard = buildTranslationKeyboard(langCodes, lang);
  let card = renderTranslation(output, lang);
  const cardMsg = await wordCtx.reply(card, {
    reply_markup: keyboard,
    parse_mode: "HTML",
  });

  // Regeneration loop — keep accepting regen clicks until save/skip
  while (true) {
    const resp = await conversation.waitForCallbackQuery(
      /^tr:(save|skip|regen:.+)$/,
      {
        otherwise: async (c) => {
          await c.reply(card, { reply_markup: keyboard, parse_mode: "HTML" });
        },
      },
    );
    await resp.answerCallbackQuery();
    const data = resp.callbackQuery.data;

    if (data === "tr:save") {
      // Save merged result to dictionary
      await conversation.external(async () => {
        await wordRepository.create(userId, {
          original: output.original,
          sourceLang: output.sourceLang,
          content: output,
        });
      });
      const saved = renderTranslation(output, lang) + "\n\n" + t("savedToDict", lang);
      await resp.editMessageText(saved, { parse_mode: "HTML" });
      break;
    }

    if (data === "tr:skip") {
      await resp.editMessageText(renderTranslation(output, lang), {
        parse_mode: "HTML",
      });
      break;
    }

    // Handle regeneration: tr:regen:<langCode>
    const regenLang = data.replace("tr:regen:", "");

    // Show loading state
    await resp.editMessageText(
      card + "\n\n" + t("regenerating", lang, { lang: regenLang.toUpperCase() }),
      { parse_mode: "HTML" },
    );

    // Regenerate single language
    try {
      const newTranslation = await conversation.external(async () => {
        const config = loadConfig();
        const { translateOne } = await import("@polyglot/core");
        return translateOne(
          {
            word: output.original,
            sourceLang: output.sourceLang,
            targetLangs: [regenLang],
            targetLang: regenLang,
            model: config.AI_MODEL,
            userId,
          },
          generateObject,
        );
      });

      // Merge new translation into existing output
      output = {
        ...output,
        translations: {
          ...output.translations,
          [regenLang]: newTranslation,
        },
      };
    } catch (err) {
      logger.error({ err, word: output.original, regenLang }, "Regeneration failed");
      // On error, keep existing translation and show error briefly
      await resp.editMessageText(
        card + "\n\n" + t("translationError", lang),
        { parse_mode: "HTML" },
      );
      // Wait a moment, then re-show the card
    }

    // Re-render card and keyboard with updated translations
    card = renderTranslation(output, lang);
    keyboard = buildTranslationKeyboard(langCodes, lang);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      cardMsg.message_id,
      card,
      { reply_markup: keyboard, parse_mode: "HTML" },
    );
  }
  ```

- [x] Ensure the scene stays under the 100-line rule. If it exceeds, extract the regeneration loop into a helper:
  ```typescript
  // In a separate file: apps/bot/src/scenes/helpers/regen.helper.ts
  export async function handleRegenLoop(
    conversation, ctx, output, lang, userId, cardMsg
  ): Promise<TranslateOutput | null> { /* ... */ }
  ```

### Step 5: Tests

- [x] **Translation service tests** (`packages/core/src/modules/translation/__tests__/translation.service.test.ts`):
  - `translateOne()` calls `translate()` with single target language
  - `translateOne()` returns `LanguageTranslation` for the requested language
  - `translateOne()` propagates errors

- [x] **Renderer tests** (`apps/bot/src/__tests__/translation.renderer.test.ts`):
  - `buildTranslationKeyboard()` creates buttons for each language code
  - Callback data format is `tr:regen:<code>`
  - Save and skip buttons are present
  - Uses correct i18n keys based on interface language

- [x] **i18n tests** (`packages/core/src/modules/i18n/__tests__/i18n.test.ts`):
  - New keys resolve correctly in all 3 locales
  - Interpolation works for `{lang}` parameter

---

## Architecture Constraints

| Package | Change scope | Notes |
|---|---|---|
| `packages/core/src/modules/translation/` | New `translateOne()` wrapper | Core stays infra-free |
| `packages/core/src/modules/i18n/` | New keys + params | No new dependencies |
| `apps/bot/src/scenes/translate.scene.ts` | Regeneration loop | May need helper extraction for 100-line rule |
| `apps/bot/src/renderers/translation.renderer.ts` | New `buildTranslationKeyboard()` | Depends on `grammy` (already in bot deps) |
| `packages/adapters/db/` | New `updateContent()` on WordRepository | Pure CRUD — persist merged content after partial regen |
| `packages/adapters/ai/` | No changes | Same `generateObject` used |

---

## Files Modified

- `packages/core/src/modules/translation/translation.service.ts` — add `translateOne()`
- `packages/core/src/modules/translation/index.ts` — export `translateOne`
- `packages/core/src/modules/i18n/types.ts` — add 3 new I18nKey entries + I18nParams
- `packages/core/src/modules/i18n/locales/en.json` — add 3 new keys
- `packages/core/src/modules/i18n/locales/ru.json` — add 3 new keys
- `packages/core/src/modules/i18n/locales/cs.json` — add 3 new keys
- `packages/core/src/modules/validation/__tests__/validate.test.ts` — add 6 single-language partial regen tests
- `packages/core/src/modules/topics/types.ts` — add `translateOne` optional dep to `TopicDeps`
- `packages/core/src/modules/topics/topic.service.ts` — add `regenerateTopicWord` to service factory
- `packages/core/src/modules/topics/__tests__/topic.service.test.ts` — add 10 tests for `regenerateTopicWord`
- `packages/adapters/db/src/repositories/word.repository.ts` — add `updateContent()` for persisting merged translations
- `packages/adapters/notifications/src/index.ts` — export createNotificationService, types
- `apps/bot/src/renderers/translation.renderer.ts` — add `buildTranslationKeyboard()`
- `apps/bot/src/scenes/translate.scene.ts` — regeneration loop with `tr:regen:<lang>` handling

## Files Created

- `packages/adapters/db/src/__tests__/word.repository.test.ts` — 12 tests for word repository (create, findByUser, findById, search, updateContent, delete)
- `packages/adapters/notifications/src/types.ts` — SendFn, UserForNotification, NotificationPayload, SuggestedWord, NotificationServiceDeps
- `packages/adapters/notifications/src/notification.service.ts` — createNotificationService factory with pickSuggestedWord (partial regeneration support)
- `packages/adapters/notifications/src/notification.service.test.ts` — 18 tests for pickSuggestedWord (happy path, partial regen, error handling, randomization)
- `apps/bot/src/scenes/helpers/regen.helper.ts` — regeneration loop helper (extracted for 100-line scene rule)
- `apps/bot/src/scenes/helpers/regen.helper.test.ts` — 9 tests for regeneration loop (save, skip, regen, merge, error handling, multiple regens)

---

## Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Scene exceeds 100-line limit with regen loop | Extract loop into `regen.helper.ts` — scene delegates to helper |
| Regenerated language loses consistency with others (e.g. different emoji/register) | Only replace the `LanguageTranslation` in the translations map; keep original top-level emoji/register |
| User spams regenerate buttons → rate limiting | Each regeneration is a full AI call; grammY conversations serialize callbacks naturally — no parallel calls |
| `editMessageText` fails if message hasn't changed | Always re-render full card after regeneration — content will differ |
| Telegram inline keyboard limits (max 8 buttons per row) | Max 4 learning languages × 1 regen button each = 4 buttons per row — well within limits |

---

## Acceptance Criteria

- [x] `translateOne()` is exported from `@polyglot/core` and returns a single `LanguageTranslation`
- [x] Translation card shows regeneration buttons for each target language (e.g. `🔄 CS`, `🔄 DE`)
- [x] Tapping a regeneration button re-translates only that language via AI
- [x] The new translation is merged into the existing result (other languages unchanged)
- [x] The card is re-rendered with updated content and keyboard after regeneration
- [x] User can regenerate multiple times before saving/skipping
- [x] "Save to dictionary" saves the final merged result (with any regenerated parts)
- [x] i18n keys `regenerateLang`, `regenerating`, `regenerated` exist in all 3 locales
- [x] All existing tests pass: `pnpm test`
- [x] All packages build: `pnpm -r run build`
- [x] Scene file stays ≤100 lines (extract helper if needed)
