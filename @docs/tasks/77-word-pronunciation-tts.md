# Task 77 — Word Pronunciation (TTS) on the Translation Card

**Status:** ✅ Done — enabled by default on `x-ai/grok-voice-tts-1.0`
**Category:** Feature / Learning aids
**Priority:** 🟠 High
**Created:** 2026-08-21
**Related:** Task 73 (AI Failover Repair), `@docs/agents/architecture.md` (AI adapter contract),
`apps/bot/src/scenes/helpers/card-actions.ts` (etymology — the closest existing precedent)

---

## Goal

Let a learner hear how a translated word is pronounced, in the languages they are
learning, without leaving the translation card.

Non-goal: a general "read this message aloud" feature. This is a pronunciation aid
for the learning target, nothing else.

---

## Constraint that shapes the whole design

**Telegram cannot render a tappable icon inline, next to a word inside message text.**
There is no per-word hit target in a Bot API message: buttons exist only in the
inline keyboard attached below the message. An `<a href>` inside HTML text cannot
fire a callback query.

So "🔊 возле слова" is realised as a dedicated keyboard row on the card carrying
one speaker button per learning language — the button *is* the icon, it just lives
under the card rather than beside the word. Every alternative (deep-link `?start=`
payloads, Web App buttons) is strictly worse: extra confirmation dialogs, a second
chat message, or a webview for a two-second audio clip.

---

## Spec

### Where the button appears

`buildTranslationKeyboard` gains a pronunciation row, rendered **above** the Save row.

Eligibility — a button is emitted for language `code` iff **all** hold:

1. `code` is in the user's `userLanguageSettings.learningLangs`
   (this is the "только у изучаемых слов" rule — no speaker on the native or
   interface-language line);
2. `code` is present in `output.translations` and `translations[code].text` is non-empty;
3. `code !== nativeLang`;
4. the card is a word or phrase card (`inputType !== "sentence"`).

Sentence cards are out of scope for v1 — noted as a follow-up below.

Ordering reuses `orderRecordEntries(output.translations, order)` so the speaker
buttons never reshuffle between taps (same rule the grammar-language buttons follow).

Layout:

- **exactly one** eligible language → a single wide button, label `t("pronounce")`
  (`🔊 Произношение` / `🔊 Pronounce`);
- **two or more** → compact per-language buttons `🔊 🇩🇪 DE`, four per row, in the
  same rows-of-four shape `sourceOverrideLangs` already uses.

Callback data: `tr:say:<code>:<msgId>`.
Worst case `tr:say:zh-Hant:2147483647` = **25 bytes**, well inside the 64-byte cap
(`isValidTelegramCallbackData`). A new entry goes into `callbackContracts` with
family `translation`, restart safety `session-backed` (it reads `translationMap`),
`expiryBehavior: "localized stale translation callback"`.

### What is spoken

`output.translations[code].text` — the translated word only. Nothing else: no
synonyms, no examples, no source word. Typical payload is 5–25 characters.

Text is trimmed and hard-capped at `ttsConfig.maxChars` (default 200). A card whose
translation somehow exceeds the cap is not spoken; the callback answers with a
localized notice rather than truncating mid-word.

### How the audio is delivered

`ctx.replyWithVoice(new InputFile(bytes, "<code>.mp3"), { reply_to_message_id: msgId })`.

Bot API accepts `.mp3` for `sendVoice`, so we request `response_format: "mp3"` from
OpenRouter and ship the bytes straight through. **No ffmpeg, no new container
dependency** — this is the reason mp3 is chosen over the API's `pcm` default.

The card itself is never edited. Pronunciation is a side effect, not a section, so
the button does not disappear after use (unlike grammar/etymology) and the card text
stays byte-identical.

### Caching — the part that keeps this free

Every successful synthesis is cached as a Telegram `file_id`, keyed by
`(text, langCode, modelId, voice)`. A repeat tap — by the same user or any other —
re-sends the cached `file_id` with zero OpenRouter calls and no upload.

`file_id` is scoped to the bot token, which is exactly the scope of the cache table,
so a shared row is always resendable. Two failure modes are handled explicitly:

- **stale `file_id`** (token rotated, file expired server-side): the `sendVoice`
  fails, the cache row is deleted, and the synthesis path runs once to heal it.
  Never surfaces to the user as an error on the first failure.
- **concurrent first taps** on the same word: the unique index makes the second
  insert a no-op (`onConflictDoNothing`); worst case is one duplicated synthesis.

New table `tts_cache` in `packages/adapters/db/src/schema.ts`:

| column | type | note |
|---|---|---|
| `id` | `serial` pk | |
| `text_hash` | `varchar(64)` not null | sha-256 of the normalized text; keeps the unique index narrow |
| `text` | `text` not null | kept for debuggability / admin inspection |
| `lang_code` | `varchar(16)` not null | |
| `model_id` | `varchar(255)` not null | so a model swap invalidates by construction |
| `voice` | `varchar(64)` not null | `""` when the model has no voice concept |
| `telegram_file_id` | `text` not null | |
| `char_count` | `integer` not null | cost attribution |
| `created_at` | `timestamptz` not null default now | |
| `last_used_at` | `timestamptz` not null default now | |
| `use_count` | `integer` not null default 1 | cache-hit-rate reporting |

Unique index on `(text_hash, lang_code, model_id, voice)`; index on `last_used_at`
for future eviction. Migration via `pnpm db:generate` + `pnpm db:push` (never
`db:migrate` on `develop`).

### Model configuration — no hardcoded model id

Task 73 established the rule the hard way: **model ids live in the database, never
in a constant.** The 2026-07-17 outage was a hardcoded slug OpenRouter rejected,
unfixable without a redeploy.

TTS follows the same rule via a new settings blob, mirroring `videoVocabulary`
(which already stores `extractionModelId` this way):

```ts
export interface TtsConfig {
  enabled: boolean;
  modelId: string;
  voice: string;
  maxChars: number;
}
```

- `SettingsPort.getTtsConfig(): Promise<TtsConfig>`
- `settings-adapter.ts`: `getWithFallback<TtsConfig>("tts", DEFAULTS.tts)`
- `settings.service.ts`: cached like every other blob
- `enabled: true`, `modelId: "x-ai/grok-voice-tts-1.0"`, `voice: "eve"` in
  `DEFAULTS.tts` — **the feature is on out of the box.** A `tts` row in
  `system_settings` overrides any field without a redeploy.

This is a deliberate departure from Task 73's "no model id in code" rule, and the
distinction is the blast radius: the primary completion model has none because a
bad value there takes *translation* down, whereas a bad value here costs a toast on
one button while everything else keeps working. The nearer precedent is
`videoVocabulary.extractionModelId`, which already ships a model id this way.

### Model selection — measured, not read off the model card

Two rounds. The shortlist came from `GET /api/v1/models?output_modalities=speech`
on 2026-08-21 (18 speech models); the decision came from probing the live
`/audio/speech` endpoint on 2026-08-22, which overturned the shortlist's winner.

**`response_format: "mp3"` is the binding constraint.** Telegram `sendVoice` takes
mp3 directly, so mp3 is what keeps ffmpeg out of the bot image.

| model | probe result |
|---|---|
| `google/gemini-3.1-flash-tts-preview` | **rejects mp3 outright** — `400 "Gemini TTS only supports response_format=pcm"`. The obvious pick on coverage (70+ languages) and the one this spec originally recommended; it would have failed on *every* call. Using it means PCM→OGG/Opus transcoding, i.e. the ffmpeg dependency this design exists to avoid. |
| `x-ai/grok-voice-tts-1.0` | **200 `audio/mpeg` for all 11 supported learning languages** (cs de en es fr it kk pl pt ru uk), 11–20 KB per word, ~0.5–1.1 s. Auto-detects the language. **Chosen.** |
| `microsoft/mai-voice-2-flash`, `mistralai/voxtral-mini-tts-2603`, `deepgram/aura-2`, `qwen/qwen-audio-3.0-tts-flash` | disqualified structurally: their voices are locale-locked (`de-DE-Klaus`, `en_paul_neutral`, `aura-2-agathe-fr`), so a single global default voice cannot serve every language. Only Grok and Gemini expose language-neutral voice names. |
| `hexgrad/kokoro-82m` | cheapest at $0.62/1M chars, but 8 languages and neither ru nor cs. |

Note the earlier assumption this corrected: the app supports **11** learning
languages (`languages.is_supported = true`), not 46. Coverage was never the
constraint that mattered — output format was.

Not verified by the probe: **pronunciation quality**, which needs a human ear.
Samples were produced for review; the byte-level result only proves the call
succeeds.

Cost at $15/1M characters: a 15-char word is **$0.000225**. 100 000 uncached
plays/month ≈ **$22**, and caching means the steady state is far below that — the
long tail of distinct words is what gets billed, not the volume of taps. The
pricing analysis that motivated this task was sized for whole-message narration;
single words are three orders of magnitude smaller.

### AI adapter surface

`packages/adapters/ai` is the only module allowed to know about OpenRouter
(architecture contract). It gains one export:

```ts
export async function generateSpeech(opts: {
  text: string;
  modelId: string;
  voice: string;
  timeoutMs: number;
}): Promise<{ bytes: Uint8Array; generationId: string | null }>;
```

Implementation note: `@openrouter/ai-sdk-provider` has no speech surface, and the
endpoint returns **raw audio bytes, not JSON**. So this is a direct
`fetch("https://openrouter.ai/api/v1/audio/speech")` inside the adapter, reusing the
same injected API key (`setAIApiKey`) and the same `AbortSignal` timeout discipline
as `generate.ts`. Verified request shape:

```jsonc
POST https://openrouter.ai/api/v1/audio/speech
{ "model": "...", "input": "...", "voice": "...", "response_format": "mp3" }
// → 200, Content-Type: audio/mpeg, body = mp3 bytes, header X-Generation-Id
```

`X-Generation-Id` is logged for cost attribution.

No model failover for v1: a failed synthesis is a toast, not a broken card, and the
failover budget-splitting machinery is built around `generateObject`. If TTS error
rates justify it later, `withModelFailover` is the seam.

### Metering

Per the product decision, TTS is **free and ungated** — no `FeatureAccessPort`
check, no `AI_CALL_WEIGHTS` entry, no consumption of the user's daily translation
credits. Real spend is negligible and the cache absorbs repeats; metering here
would cost more in user friction than in dollars.

What ships instead is **visibility**, so the decision can be revisited on data
rather than on vibes:

- `logEvent("card.tts_played", { lang, cached, chars, generationId })`
- `logEvent("card.tts_failed", { lang, ...errorFields(err) }, "error")`

Cache-hit rate and character volume are then trendable in Loki/Grafana. A daily cap
is a one-line follow-up if abuse ever appears; it is deliberately not built now.

---

## Test plan (spec-first)

Derived from the spec above, per Hard Rule 5.

**Unit — `translation.renderer.test.ts`** (keyboard shape is pure and worth pinning):

- emits no pronunciation row when `learningLangs` is empty
- emits no button for the native language even when it is in `translations`
- emits no button for a learning language absent from `translations`
- single eligible language → one wide `t("pronounce")` button
- three eligible languages → three compact buttons, one row, stable order
- five eligible languages → 4 + 1 across two rows
- every emitted callback satisfies `isValidTelegramCallbackData`

**Unit — `tts.service.test.ts`** (core): cache-hit returns the stored `file_id`
without calling synthesis; cache-miss synthesizes then writes; over-cap text is
rejected before any AI call.

**Unit — ai adapter**: `generateSpeech` sends the exact documented body, returns
bytes on 200, throws on non-2xx, aborts on timeout.

**Integration — `apps/bot/src/__tests__/integration/tts-pronunciation.integration.test.ts`**
(mandatory under Hard Rule 5a — this crosses callback → service → Postgres):

- tapping `tr:say:de:<mid>` on a real card sends a voice message and writes one
  `tts_cache` row
- tapping it again sends the cached `file_id` and performs **zero** synthesis calls,
  with `use_count` incremented
- a stale `file_id` (send fails once) deletes the row, re-synthesizes, and the user
  still receives audio
- an expired `translationMap` entry answers with the localized stale-callback notice
- `enabled: false` renders no button at all

**Not tested** (per the "avoid low-value tests" rule): that `TtsConfig` fields have
the right types (TypeScript), and OpenRouter's own audio quality.

---

## Localization

New keys in all 11 locale files under `packages/core/src/modules/i18n/locales/`
(`en, ru, cs, de, es, fr, it, kk, pl, pt, uk`):

- `pronounce` — single-language button label
- `ttsUnavailable` — synthesis failed toast
- `ttsTooLong` — over the character cap

---

## Follow-ups (explicitly out of scope for v1)

1. **Sentence cards** — `renderSentenceTranslation` has no pronunciation row.
   Arguably the highest-value surface for TTS; deferred to keep v1 to one renderer.
2. **Flashcard / SRS / dictionary / notification cards** — the same button on
   `flashcard.renderer.ts`, `srs.renderer.ts`, `dict:view`, and `notif:*`.
3. **Per-language voice mapping** — one voice for all languages is a compromise;
   `supported_voices` from the models API would allow a per-language choice.
4. **Cache eviction** — `last_used_at` is indexed for it, but nothing prunes yet.
   Rows are small (a `file_id` and a word); this is not urgent.
5. **Admin panel UI** for the `tts` settings blob — overriding the default is a
   hand-written `system_settings` row today; a form belongs with the rest of the AI
   settings screen.
6. **Gemini 3.1 Flash TTS via PCM.** Its 70+ language coverage and inline tags
   (`[whispers]`) are genuinely better than Grok's, and it is only excluded by the
   mp3 constraint. If ffmpeg ever enters the bot image for another reason, re-probe
   it with `response_format: "pcm"` and reconsider.
