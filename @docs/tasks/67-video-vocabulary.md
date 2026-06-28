# Task 67 — Video Vocabulary (YouTube Phrase Extraction)

**Status:** 🔲 To Do
**Category:** Feature
**Blocks:** Milestone 3 (Content-Based Learning)
**Created:** 2026-06-27

---

## Goal

Allow users to extract vocabulary from YouTube videos. The user pastes a YouTube URL, the bot extracts the transcript, AI analyzes it and returns top phrases ranked by learning value for the user's level. Phrases are browsed inline and saved to the existing dictionary with lazy translation via the unified notification queue.

## Cost Estimate

| Scenario | Input tokens | Output tokens | Cost (Gemini 3.1 Flash Lite) |
|----------|-------------|--------------|-------------------------------|
| 3h podcast (worst case) | ~47,000 | ~7,500 | $0.023 |
| Per user/month (3 videos) | — | — | ~$0.07 |
| 1,000 users/month | — | — | ~$70 |
| With lazy translation (4 langs) | +3,000 | +6,000 | +$0.010/video |

Pricing: Gemini 3.1 Flash Lite — $0.25/1M input, $1.50/1M output.

---

## Product Decisions

### Extraction

| # | Decision | Choice |
|---|----------|--------|
| 1 | What to extract | Words + idioms + collocations + phrasal verbs, ranked by level |
| 2 | Max phrases | Default 30, configurable per user in DB (`max_phrases_per_video`) |
| 3 | Max video length | 3 hours |
| 4 | AI model | Gemini 3.1 Flash Lite via OpenRouter |
| 5 | AI request strategy | One request per full transcript (fits in 1M context window) |
| 6 | AI output format | Structured JSON via `response_mime_type` + Zod schema |
| 7 | Output fields | `phrase`, `type` (word/idiom/collocation/phrasal_verb), `level` (A1-C2), `context` (sentence from transcript), `timestampSeconds` |
| 8 | Phrase sorting | By learning value for user's proficiency level |
| 9 | Few phrases found | Return as many as found, no padding |

### Languages & Subtitles

| # | Decision | Choice |
|---|----------|--------|
| 10 | Supported video languages | User's native + learning languages |
| 11 | No matching subtitles | Notify user, don't consume limit |
| 12 | Multiple subtitle languages | Use video's original language |
| 13 | Subtitle priority | Manual first, auto-generated fallback |
| 14 | User proficiency level | Per language, from settings. Add to onboarding. |

### Translation

| # | Decision | Choice |
|---|----------|--------|
| 15 | When to translate | Lazy — at notification/flashcard time, not at extraction |
| 16 | Why lazy | User saves ~10 of 30 phrases; translating all 30 on 4 languages is wasteful |

### Limits & Storage

| # | Decision | Choice |
|---|----------|--------|
| 17 | Monthly limit | 3 videos/month, hard limit |
| 18 | Limit reset | Calendar month (1st of each month) |
| 19 | Limit enforcement | Count `videoProcesses WHERE status != 'failed' AND yearMonth = current` |
| 20 | When limit consumed | At confirmation (before processing). Refunded on error. |
| 21 | Transcript storage | Full transcript stored in DB (~200KB per 3h video) |
| 22 | Transcript caching | Shared by `video_id + language` across users |
| 23 | Extraction caching | Per user (different levels = different phrases) |
| 24 | Unsaved phrases | Persist forever, accessible via "My Videos" |

### Architecture

| # | Decision | Choice |
|---|----------|--------|
| 25 | Service architecture | Monolith (in monorepo), not separate service |
| 26 | Container | Single container (bot + processing) |
| 27 | Processing model | Async, in-process queue (no Redis/BullMQ) |
| 28 | Error handling | Auto-retry 2 attempts (2s, 4s backoff), then notify user |
| 29 | Non-YouTube video links | Show "Only YouTube is supported for now" |

### UX Flow

| # | Decision | Choice |
|---|----------|--------|
| 30 | Initiation | Auto-detect YouTube URL in chat |
| 31 | Confirmation | Yes — show title, duration, language, remaining limit + [Extract] [Cancel] |
| 32 | Processing feedback | "Processing..." → notification when done |
| 33 | Result display | Inline browse, 5 phrases per page |
| 34 | Phrase card format | Phrase + context sentence from transcript |
| 35 | Save action | Button per phrase → saves to dictionary without translation |
| 36 | Duplicate video | Show saved results, don't re-process, don't consume limit |
| 37 | Deep links | Each phrase has YouTube timestamp link (`youtube.com/watch?v=xxx&t=123`) |
| 38 | History | `/videos` command → "My Videos" list with date, title, status, phrase count |
| 39 | Rate limiting | Check limit before showing confirmation |

---

## UX Flow Diagram

```
User sends YouTube URL
  │
  ├─ Not YouTube video URL? → ignore
  ├─ Non-YouTube video platform? → "Only YouTube supported"
  ├─ No subtitles on native/learning langs? → "Subtitles not available"
  ├─ Already processed? → show saved results (browse mode)
  ├─ Monthly limit reached? → "Limit reached (resets [date])"
  │
  └─ Show confirmation:
       "🎬 Joe Rogan Experience #2100
        Duration: 2:45:00 | Language: English
        Remaining: 2/3 this month
        [Extract Phrases] [Cancel]"
          │
          ├─ Cancel → delete message
          └─ Extract → consume limit, enqueue job
               │
               ├─ "⏳ Processing video..."
               │
               └─ Job completes:
                    ├─ Success → "✅ Found 28 phrases! [Browse]"
                    │    │
                    │    └─ Browse (5 per page):
                    │         "🔹 break it down
                    │          'He broke down the argument into three parts'
                    │          ▶️ 1:23:45
                    │          [Save] [Already saved ✓]
                    │
                    │          🔹 cut to the chase
                    │          'Let me cut to the chase here'
                    │          ▶️ 0:45:12
                    │          [Save]
                    │
                    │          [<< Prev] [Page 1/6] [Next >>]
                    │          [Close]"
                    │
                    └─ Failure (after 2 retries) → "❌ Failed. Limit refunded."
```

---

## Database Schema

### New Tables

**`userLearningLanguages`** — per-language proficiency level
```
id serial PK
userId FK → users (onDelete cascade)
languageCode text NOT NULL
proficiencyLevel text NOT NULL DEFAULT 'B1'  -- A1/A2/B1/B2/C1/C2
createdAt timestamp
updatedAt timestamp
UNIQUE(userId, languageCode)
```

**`videoProcesses`** — one row per user×video processing request
```
id serial PK
userId FK → users (onDelete cascade)
videoId text NOT NULL              -- YouTube video ID
videoUrl text NOT NULL
title text
durationSeconds integer
language text NOT NULL             -- transcript language code
transcriptType text                -- 'manual' / 'auto-generated'
status text NOT NULL DEFAULT 'pending'  -- pending/processing/completed/failed
errorMessage text
createdAt timestamp
updatedAt timestamp
INDEX(userId)
INDEX(videoId, language)
INDEX(userId, status)
```

**`videoPhrases`** — extracted phrases per process
```
id serial PK
videoProcessId FK → videoProcesses (onDelete cascade)
phrase text NOT NULL
phraseType text                    -- word/idiom/collocation/phrasal_verb
level text                         -- A1-C2
context text                       -- sentence from transcript
timestampSeconds integer           -- position in video for deep link
sortOrder integer NOT NULL         -- learning value rank (1 = most useful)
savedEntryId FK → vocabularyEntries (nullable)
createdAt timestamp
INDEX(videoProcessId, sortOrder)
```

**`videoTranscriptCache`** — shared transcript cache across users
```
id serial PK
videoId text NOT NULL
language text NOT NULL
transcript text NOT NULL           -- full transcript text
transcriptType text
createdAt timestamp
UNIQUE(videoId, language)
```

### Modified Tables

- `systemSettings` — seed key `videoVocabulary` with value `{ monthlyLimit: 3, maxPhrasesDefault: 30, extractionModelId: "google/gemini-3.1-flash-lite" }`
- `aiModels` — seed Gemini 3.1 Flash Lite entry

---

## Files Likely Affected

### New Files
- `packages/adapters/youtube/` — new adapter package (url-parser, metadata, transcript)
- `packages/core/src/modules/video-vocabulary/` — domain module (types, schema, prompt, service)
- `packages/core/src/ports/video-vocabulary.repository.ts` — repository port
- `packages/core/src/ports/youtube.port.ts` — YouTube adapter port
- `packages/adapters/db/src/repositories/video-vocabulary.repository.ts` — DB repository
- `apps/bot/src/scenes/helpers/video-vocabulary.helper.ts` — bot handlers
- `apps/bot/src/renderers/video-vocabulary.renderer.ts` — Telegram message formatting
- `apps/bot/src/video-vocabulary/queue.ts` — in-process async queue

### Modified Files
- `packages/adapters/db/src/schema.ts` — new tables
- `packages/adapters/ai/src/models.ts` — add Gemini 3.1 Flash Lite
- `packages/core/src/ports/container.ts` — add videoVocabularyRepository, youtube
- `packages/core/src/ports/settings.port.ts` — add getVideoVocabularyConfig()
- `packages/adapters/db/src/settings-adapter.ts` — implement video config
- `packages/adapters/db/src/repositories/user.repository.ts` — language level methods
- `packages/core/src/ports/user.repository.ts` — language level port
- `apps/bot/src/middlewares/mode-router.ts` — YouTube URL detection
- `apps/bot/src/bot-factory.ts` — register /videos command + vid:* callbacks
- `apps/bot/src/container.ts` — wire video vocabulary services + job processor
- `apps/bot/src/types.ts` — session data for video confirmation
- `apps/bot/src/scenes/onboarding.scene.ts` — proficiency level step
- `apps/bot/src/scenes/helpers/settings.helper.ts` — language level option
- `apps/bot/src/commands/commands.ts` — /videos command
- `packages/core/src/modules/i18n/locales/{en,ru,cs}.json` — i18n keys
- `packages/adapters/notifications/src/scheduler.ts` — lazy translation at send time

---

## Acceptance Criteria

- [ ] User can paste a YouTube URL and get a confirmation with video metadata
- [ ] Non-YouTube video links show "only YouTube supported" message
- [ ] Videos without subtitles in user's languages show appropriate message
- [ ] Processing is async with notification when complete
- [ ] Phrases displayed in inline browser (5 per page) with context and timestamp deep link
- [ ] User can save individual phrases to dictionary
- [ ] Saved phrases enter SRS/notification flow with lazy translation
- [ ] Monthly limit of 3 enforced, consumed at confirmation, refunded on error
- [ ] Duplicate video detection shows existing results
- [ ] `/videos` command shows processing history
- [ ] Transcript cached and shared across users
- [ ] Proficiency level selectable per language in onboarding and settings
- [ ] All UI text has i18n keys in en/ru/cs

---

## Dependencies

- `youtube-transcript` npm package (or equivalent) for transcript extraction
- Gemini 3.1 Flash Lite available via OpenRouter

## Effort Estimate

~20–25 hours total:
- Phase 1 (DB): 4h
- Phase 2 (YouTube adapter): 3h
- Phase 3 (Core module): 3h
- Phase 4 (Bot integration): 6h
- Phase 5 (Onboarding/Settings): 3h
- Phase 6 (i18n): 1h
- Phase 7 (Notifications): 2h
