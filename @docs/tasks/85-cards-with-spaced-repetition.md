# Task 85: One card deck — flashcards run on spaced repetition

Type: Feature + cleanup.
Status: done.
Supersedes: `technical-debt-dictionary-deck-module.md` (deleted with this task).

## Problem

The bot had two review modes over the same dictionary that looked identical and meant
different things:

- **🎴 Cards** (`/flashcard`, hot button): 10 random words, three grades that only wrote
  `vocabulary_entries.difficulty` (notification weighting). Nothing scheduled, nothing learned.
- **🔁 Review** (`/review`, buried in `/menu → Learning`): SM-2 over due translation rows,
  the only surface that earns "moved into long-term memory" — and a dead end ("nothing due")
  most of the time.

The mode most users reach teaches least, the grade buttons mean different things on two
look-alike screens, and the motivation layer's strongest evidence is unreachable from it.

## Decision

Keep **Cards** as the only review surface and run it on the existing SM-2 state. No schema
change: `vocabulary_translations.srs_*`, `vocabulary_entries.difficulty` and `word_review_log`
are reused as they are.

## Behavior spec

### Deck (built once per session, pure core function)

1. **Unit** — one card = one translation row (a word × one target language), so the card
   states which language to recall. **At most one card per entry per session**: a word saved
   in two languages never appears twice in one deck; its other language stays due for a later
   session.
2. **Due first** — rows with `srs_due_date <= now` or `NULL`, most overdue first
   (existing `findDueForSrs` order).
3. **Practice ahead fills the rest** — when fewer due cards than the session size exist, the
   deck is topped up with not-yet-due rows, weakest first: entry `difficulty = 'hard'` first,
   then lowest `srs_ease_factor`, then soonest `srs_due_date`. Such cards carry an `ahead` flag
   and show a one-line note ("practice ahead"). So the deck is never empty while the
   dictionary has words.
4. **Size** — `DictionaryConfig.flashcardLimit` (admin-owned, default 10). It already existed
   and had no reader.
5. **Empty dictionary** — the `/review` empty-dictionary copy (it tells the user how to fill it).

### Rating (4 buttons: Again / Hard / Good / Easy)

| Card | Again | Hard | Good | Easy |
|---|---|---|---|---|
| due | SM-2 | SM-2 | SM-2 | SM-2 |
| ahead | SM-2 (interval 1, due tomorrow) | ease −0.15, interval halved (min 1), due = now + interval | no SRS write | no SRS write |
| retry (see below) | no write | no write | no write | no write |

- Ahead + Good/Easy never lengthens the interval: reviewing early is not evidence the longer
  gap was survived. Ahead + Again/Hard shows a weakness, so it pulls the word closer.
- Every first presentation writes the notification grade into `difficulty`
  (again/hard → `hard`, good → `normal`, easy → `easy`) so notifications keep one grade per word,
  and logs a `word_review_log` row (`session_type = 'flashcard'`, which also credits momentum).
- **Again re-queues the card once** at the end of the deck (flag `retry`). A retry is shown and
  rated to finish the loop but writes nothing — the schedule was already set.
- Buttons carry the translation id; a rating for a card other than the current one answers
  "session expired" and changes nothing. If the entry was removed elsewhere, its card leaves the
  deck and the next card opens.
- Mature crossing (`recordMatureIfCrossed`) and "hard word recalled" evidence feed the finish
  screen's praise line exactly as `/review` did.

### Finish screen

`Done — cards: N · recalled: M` (Good/Easy on first presentation), praise line, buttons
New deck / Close / 📈 Progress (when enabled).

### Entry points and compatibility

- `/flashcard`, the 🎴 hot button, `/menu → Learning → Cards` and onboarding's "training"
  button open the deck. `/review` stays registered as an alias.
- The Learning hub drops its separate 🔁 Review entry; an old `lrn:review` button still opens Cards.
- The progress screen's review button opens Cards (`fc:restart`).
- Callbacks: `fc:reveal`, `fc:rate:{again|hard|good|easy}:{translationId}`, `fc:del:{entryId}`,
  `fc:quit`, `fc:close`, `fc:restart`. Legacy buttons in chat history: `srs:restart` → new deck,
  `srs:close` → close, every other `srs:*` and `fc:next|done|start|fb:*` → localized
  "session expired". `progress:open:srs_done` keeps working.
- Session lives under a new `cards` key; the old `flashcard`/`srs` keys are dropped from the
  type, so a pre-deploy session with the old deck shape is ignored instead of misread.
  Dates inside the session come back from jsonb as strings — nothing reads them after the
  deck is built (the `ahead` flag is computed at build time).

### Removed

- `/review` scene, SRS helper, SRS renderer and their tests (behavior moves to Cards).
- `packages/core/src/modules/dictionary-pipeline/` (Cards was its last caller), `FLASHCARD_CONFIG`
  and friends, `WordDisplayData`.
- `wordReviewRepository.getReviewCounts / getReviewsForWord / getReviewsBySessionType` if no
  runtime caller remains.
- `DictionaryConfig.notificationDictLimit` / `wordOfDayLimit` (no reader) from core, adapter
  defaults, admin contract and admin UI.
- i18n keys no longer referenced; `srs` callback family; `srs_done` praise surface.

### Non-goals

- No change to SM-2 for due cards, to notifications' `srs` word source, or to the schema.
- No new learning-step scheduler beyond the single in-session retry.

## Tests (derived from the spec)

- Core unit: deck builder (due first, one per entry, ahead top-up order, limit, empty);
  ahead/retry scheduling table above.
- Bot unit: keyboards (callbacks, 64-byte limit), ahead note on front, finish counts.
- Integration (real dispatcher + Postgres), `cards-review.integration.test.ts`: due card rated
  Good writes SM-2 + difficulty + review log; nothing due → ahead deck, Good leaves SRS columns
  untouched, Again sets due tomorrow and re-shows the card last; two-language word appears once;
  `/review` and legacy `srs:restart` open the same deck, legacy `fc:next` answers expired; stale
  rating changes nothing. Existing card-review-actions, momentum and word-card-consistency
  integration tests move to the Cards flow.
