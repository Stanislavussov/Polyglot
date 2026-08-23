# Task 80 — Voice Input (STT): Translate What the User Says

**Status:** ✅ Done — enabled by default on `openai/whisper-large-v3-turbo`
**Category:** Feature / Paid tier
**Priority:** 🟠 High
**Created:** 2026-08-23
**Related:** Task 77 (Word Pronunciation TTS — the structural template), Task 79 (paid-features
presentation layer — the gating machinery), Task 73 (AI Failover Repair — the "model ids live
in the database" rule), `@docs/agents/architecture.md` (AI adapter contract),
`.claude/skills/bot-testing/SKILL.md` (integration-test harness)

---

## Goal

Let a learner send a **voice message** instead of typing: the bot transcribes it with an
AI speech-to-text model and feeds the transcript into the exact same translation flow a
typed message takes. Nothing else changes — the card, the buttons, the history are all
the ordinary translation pipeline.

Non-goals: voice *replies* (that is Task 77's TTS, already shipped), voice commands or
navigation, transcription of forwarded audio files / video notes (only `message.voice`),
and any always-listening mode.

## Product decision — who gets it

Voice input is a **Pro-tier feature** (the most expensive purchasable plan — the one that
already carries audio via `pronunciation`). Mechanically:

- New `FEATURE_KEYS.voiceInput`, seeded into `PRO_FEATURES` in `apps/admin-api/src/seed.ts`
  → granted to `pro` and `unlimited`, denied to `free` and `plus`. Admin/tester roles pass
  via the usual `resolveEntitlements` override.
- The feature is not advertised anywhere until used: there is no new button. A free/plus
  user who sends a voice message gets the standard upgrade screen
  (`sendUpgradeScreen(ctx, lang, FEATURE_KEYS.voiceInput)`) — the voice message itself is
  the discovery surface.
- The upsell plan bullets gain a `planLineVoiceInput` line so Pro's card shows what the
  tier includes.

Gating note: `ensurePaidFeature` assumed a callback-query context (`answerCallbackQuery`).
Voice arrives as a plain message, so the gate has a message-context variant that skips the
callback answer and goes straight to the upgrade screen.

## The pipeline

```
message.voice → mode-router intercept → gate (plan) → duration cap → getFile + download
→ AI transcription (OpenRouter) → handleTranslateText(ctx, transcript)  [unchanged]
```

- **Seam:** `apps/bot/src/middlewares/mode-router.ts` rejected all non-text with `textOnly`.
  Voice is intercepted just before that rejection and delegated to
  `apps/bot/src/scenes/helpers/voice-input.ts`. When STT is disabled (config `enabled:false`
  or blank `modelId`) the old `textOnly` rejection still happens — the feature switches off
  cleanly without a redeploy.
- **Duration cap** (`sttConfig.maxDurationSec`, default 60) is checked against
  `message.voice.duration` **before** any download or AI call; over-cap answers with the
  localized `voiceTooLong` notice.
- **Download:** `ctx.api.getFile` + fetch of `https://api.telegram.org/file/bot<token>/<path>`
  through the same injected `fetch` the grammY client uses, so the integration harness can
  intercept it exactly like Bot API calls.
- **Handoff:** `handleTranslateText(ctx, transcript)` — already callable with an arbitrary
  string (the idle-fallback path uses it that way). Input validation (500-char cap, emoji,
  digits) applies to the transcript like to any typed text.
- Empty transcript or a transcription error → localized `voiceTranscriptionFailed`; the
  translation AI is never called in that case.

## Transcription — verified API contract, not read off the docs

Live probe on 2026-08-23 (same methodology as Task 77's TTS probe, which overturned that
spec's original model choice):

```jsonc
POST https://openrouter.ai/api/v1/audio/transcriptions
{ "model": "...", "input_audio": { "data": "<base64>", "format": "ogg" } }
// → 200 {"text": "...", "usage": {"seconds": 3.168, "cost": 0.0000105}}
// → header X-Generation-Id: gen-stt-...
```

The decisive findings:

- **OGG/Opus — Telegram's voice format — is accepted directly** with `format: "ogg"`.
  The docs only promise "OGG Vorbis" and are silent about Opus; the probe settles it.
  **No ffmpeg, no transcoding, no new container dependency.**
- Model catalogue for the admin picker: `GET /api/v1/models?output_modalities=transcription`
  (19 models on probe day).
- Unlike TTS (raw bytes, zero-cost placeholder), the response is JSON with **real
  `usage.seconds` and `usage.cost`** — logged per call.

| model | probe result |
|---|---|
| `openai/whisper-large-v3-turbo` | 200 for ru ✓ kk ✓ de ✓ from OGG/Opus; $0.00000333/sec ≈ **$0.0002/min**. **Chosen default.** |
| `mistralai/voxtral-mini-3b-2507` | 200 for ru ✓, ~5× the price of whisper-turbo; Kazakh coverage unverified. |

Cost at the default: a 30-second voice message ≈ **$0.0001**. Even 100k voice messages a
month ≈ $10 — and only Pro subscribers can send them.

`packages/adapters/ai/src/transcribe.ts` mirrors `speech.ts`: raw `fetch` (the
`@openrouter/ai-sdk-provider` has no transcription surface), `getApiKey()`, the shared
abort-budget discipline, `requestKind: "transcription"` into the shared log/metric sink.
No failover for v1 — a failed transcription is a notice, not a broken card (same reasoning
as TTS).

## Model configuration — the Task 73 rule

No hardcoded model constant on the call path. A new settings blob, exactly like `tts`:

```ts
export interface SttConfig {
  enabled: boolean;
  modelId: string;   // empty = feature disabled
  maxDurationSec: number;
}
```

- `SettingsPort.getSttConfig()`; adapter `getWithFallback("stt", DEFAULTS.stt)`;
  60s-cached in `settings.service.ts` with `FALLBACK_STT` kept byte-identical to
  `DEFAULTS.stt`.
- Default `{ enabled: true, modelId: "openai/whisper-large-v3-turbo", maxDurationSec: 60 }`
  — on out of the box (probed working), overridable per-field from the admin panel without
  a redeploy. Same blast-radius justification as `tts`: a bad value costs one notice on
  voice messages while translation keeps working.

## Admin panel

`/settings` → **Voice input** tab, a clone of the Pronunciation trio:

| endpoint | purpose |
|---|---|
| `GET /api/settings/stt` | current config, backfilled `{...FALLBACK_STT, ...(value ?? {})}` (the tts.ts merge pattern — **not** the bare `ai-defaults` read that renders partial blobs field-less) |
| `PUT /api/settings/stt` | save; rejects an enabled config with a blank model |
| `GET /api/settings/stt/models` | live OpenRouter transcription catalogue (`?output_modalities=transcription`) with pricing |

Validation via `sttSettingsSchema` in `packages/admin-contracts`. The UI is a dedicated
`SttSettingsForm.vue` (model picker fed by the catalogue, enabled toggle, duration cap),
bypassing the generic key/value form the way `TtsSettingsForm` does.

No synthesis probe button for v1: unlike TTS (where mp3-vs-pcm output decided viability and
was invisible in the catalogue), STT viability was settled by the live probe above, and a
probe would need an audio sample in the browser. Follow-up if model swaps become frequent.

## Observability

- `logEvent("voice.transcribed", { durationSec, chars, generationId })`
- `logEvent("voice.transcribe_failed", { ...errorFields(err) }, "error")`
- Adapter-level `ai.request.completed/failed` with `requestKind: "transcription"`, real
  seconds/cost → `ai_request_latencies` (TS-union extension only, no migration).

## Test plan (spec-first, Hard Rule 5/5a)

**Unit** — entitlements matrix (pro/unlimited grant, free/plus deny); `stt` defaults spec
(mirrors `tts-defaults.test.ts`); settings-adapter partial-blob backfill; adapter
`transcribeAudio` (exact body, trimmed text, non-2xx, timeout, missing usage, whitespace
text); voice-input helper (deny/disabled/over-duration/failure/happy paths); admin `stt`
route (backfill GET, blank-model PUT rejection, models proxy).

**Integration** — `apps/bot/src/__tests__/integration/voice-input.integration.test.ts`
through the real dispatcher + Postgres (Hard Rule 5a): pro user's voice update → mocked
getFile/download/transcription → real translation card persisted; free user → upgrade
screen, zero AI calls; disabled → `textOnly`; over-duration → `voiceTooLong`; transcription
failure → `voiceTranscriptionFailed`, no translation call.

**Not tested:** OpenRouter's own transcription quality; `SttConfig` field types (TypeScript).

## Localization

New keys in all 11 locales: `featureVoiceInput`, `planLineVoiceInput`,
`voiceTranscriptionFailed`, `voiceTooLong` (`{max}` placeholder).

## Follow-ups (out of scope for v1)

1. **Language hint** — pass the user's learning/native langs to the model for better
   accuracy on ambiguous short clips (whisper auto-detects; a hint param exists on some models).
2. **Admin probe button** — transcribe a canned sample against the selected model.
3. **`video_note` / `audio` messages** — only `message.voice` is handled in v1.
4. **Transcription failover** — `withModelFailover` is the seam if error rates justify it.
5. **Voice-message length UX** — Telegram Premium users can send very long voice notes; the
   cap notice could suggest splitting.
6. **Voice during a pending wizard** — a user mid-`dictionaryWizard` (or awaiting a
   clarification/notification context) who answers by voice gets the transcript translated
   as a word while the wizard stays pending, same as the emoji branch behaves today. If
   wizards should consume voice answers, that is a separate seam.
7. **Split `voice.download_failed` out of `voice.transcribe_failed`** — today a Telegram
   file-API failure logs under the transcription event name (diagnosable via the error
   message, but not separable in Loki without reading it).
