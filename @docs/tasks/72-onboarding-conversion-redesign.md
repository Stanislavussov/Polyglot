# Task 72 — Onboarding Conversion Redesign: Real Value in 3 Screens

**Status:** ✅ Done
**Category:** Product / Activation
**Created:** 2026-08-01
**Implemented:** 2026-08-01

---

## Implementation notes (2026-08-01)

### Ordering deviation: stateless first

The slice table below sequences slices 1–6 *inside* the existing grammY conversation and
rewrites them stateless in slice 7. The implementation inverted that: slice 7's architecture
was built first and screens 0–3 were written directly onto it. The end state is identical,
but it avoids implementing every screen twice and throwing the conversation version away.
`onboarding.scene.ts`, `stale-onboarding.helper.ts` and their tests are deleted.

### Where things live

| Concern | File |
|---|---|
| Step/outcome vocabulary + Prometheus counter | `apps/bot/src/onboarding/onboarding-steps.ts` |
| State derived from the DB on every update | `apps/bot/src/onboarding/onboarding-state.ts` |
| Keyboards (2-column, inline CEFR row) | `apps/bot/src/onboarding/onboarding-keyboards.ts` |
| The four screens | `apps/bot/src/onboarding/onboarding-screens.ts` |
| Callback + text routing | `apps/bot/src/onboarding/onboarding-handlers.ts` |
| Cached/live hook cards | `apps/bot/src/onboarding/hook-cards.ts` |
| Curated headwords (source of truth) | `packages/core/src/modules/onboarding/hook-words.ts` |
| Card cache | `onboarding_demo_cards` + `onboardingDemoCardRepository` |
| D+1 nudge | `apps/bot/src/onboarding/activation-nudge.*` |

Callback namespace: `onb:nat:*`, `onb:lang:*`, `onb:lvl:<code>:<A1..C2|unknown|remove>`,
`onb:collapse`, `onb:done`, `onb:hook:<lang>:<index>`, `onb:go:<feature>`. The D+1 nudge
uses `nudge:card:*` deliberately — `onb:` taps are ignored for already-onboarded users.

### Review step for demo cards

Generation never publishes. The warm-up script and the live cache-miss write path both leave
`is_active = false`, and only `onboardingDemoCardRepository.setActive(...)` flips it. **A card
is not served to anyone until that is done.**

The review step is the **Demo Cards** page in the admin panel: it lists cached cards with their
payloads (active *and* inactive — a reviewer has to read exactly the rows the bot refuses to
serve), lets you approve or un-approve each one, and shows a cached-vs-servable counter so the
review backlog is visible rather than silent. Backed by `GET /api/onboarding-demo-cards` and
`PUT /api/onboarding-demo-cards/active`.

### Not done here

- The screencast asset itself (out of scope by the spec). `ONBOARDING_SCREENCAST_FILE_ID`
  in `apps/bot/src/constants.ts` is empty, which is the normal state — set it when the video
  exists. Deliberately a constant, not an env var: a `file_id` is not a secret, never changes
  once uploaded, and does not vary between environments.
- Making the CEFR level actually shape translation output (Open Question 3) — still a
  follow-up, and until it lands the level question is a promise the product does not keep.
- Rotating the D+1 nudge away from a hook word the user has already seen. Tapping a **cached**
  hook card writes no `translation_requests` row, so a user who tapped one and then stopped is
  still nudge-eligible and may be shown the same headword. The copy does not claim novelty, so
  this reads as "remember this?" rather than a bug — but with only three curated words per
  language there is no way to guarantee a fresh one anyway.

---

## Problem

Live users go through onboarding, tap around, and drop off without ever seeing what the
product does. The current flow (`apps/bot/src/scenes/onboarding.scene.ts`) has four
independent defects that compound:

### 1. The "aha moment" is a placeholder

`stepDemoTranslation()` (line 364) never calls the translation pipeline. It renders the
static i18n key `demoResult`:

```
🔤 *{word}*
_(AI-перевод появится здесь после подключения)_
```

The user completes the whole setup, types their first word, and is told the translation
will appear "once connected". This is the single largest drop-off cause and it is not a
tuning problem — the payoff screen is a stub. Already filed as
`@docs/tasks/38-fix-onboarding-demo-translation.md`, never implemented.

### 2. ~11 taps and up to 7 screens before any value

| Step | Screen | Taps |
|------|--------|------|
| 1 | Native language — 10 buttons, **one per row** (`.row()` on every button, line 155) | 1 + scroll |
| 2 | Learning languages — 9 buttons one per row + Done + Back | 2–5 |
| 3 | CEFR level — **a separate screen per learning language** (line 312 loop) | 1–4 |
| 4 | Demo — free-text input, then the placeholder above | typing |

Worst case: 7 screens, ~11 interactions, payoff = fake card.

### 3. The CEFR step costs up to 4 screens and currently drives nothing

`user_learning_languages.proficiency_level` already defaults to `"B1"`
(`packages/adapters/db/src/schema.ts:772`), and the only consumer in the codebase is
video vocabulary extraction (`video-vocabulary.helper.ts:767`, which itself falls back to
`"B1"`). The translation pipeline does not read it.

The problem is not the question — the level is genuinely needed per language — it is the
**packaging**: a dedicated full screen per language, asked before the user has seen a single
card, in exchange for a value the product does not yet deliver. The fix is to fold the
question into the language choice (decision 3) and to make the answer actually shape the
output (decision 3a).

### 4. No promise, no instructions, no next step

- First message is `chooseNativeLang` — "🏠 Какой ваш родной язык?". No statement of what
  the bot does or how long setup takes.
- Last message is `onboardingComplete` — "Используйте /translate". Slash commands are a
  poor call to action; there is no mention of the dictionary, flashcards, SRS, templates,
  video vocabulary, or notifications.

### 5. Structural fragility of the conversation-based flow

The flow lives inside a grammY conversation, which brings known production failure modes:

- 10-minute `maxMillisecondsToWait` timeout leaves `lang:` / `learn:` buttons dead
  (2026-08-01 incident). `stale-onboarding.helper.ts` recovers by **restarting onboarding
  from step 1** — a user who already picked three languages is asked for their native
  language again.
- An abandoned conversation swallows every subsequent message (`next: true` mitigations
  all over the file, lines 166–173).
- `ctx.session` can be `undefined` in a replayed conversation, which already crashed
  completion once (comment at lines 126–135).

### 6. Drop-off is not measurable

`updateOnboardingStep` is called **only for steps 1 and 2** (lines 71 and 84). Steps 3 and
4 are never recorded, so a user who abandoned on the CEFR screen and one who abandoned on
the demo are indistinguishable in the DB. We cannot tell whether a redesign helped.

---

## Goal

A new user reaches a **real, rendered translation card within 3 screens and 5 taps** of
`/start`, without typing anything, and finishes with a short instruction plus tappable
entry points into the main features.

Tap budget for the single-language happy path: confirm native (1) + language (1) + level (1)
+ Готово (1) + hook word (1). Each extra learning language adds 2 taps and **no** extra
screen.

**Target:** `/start` → real card in under 60 seconds, no free-text input required.

---

## Product Decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Flow mechanics | **Leave the grammY conversation.** Onboarding becomes stateless: plain callback handlers + `users.onboarding_step` as the state. Kills the timeout/dead-button/swallowed-message class entirely and makes the flow restart-safe (Task 61 posture). |
| 2 | Native language | **Guess from `ctx.from.language_code`**, confirm with one tap. Full picker behind "Другой язык". |
| 3 | CEFR level | **Kept, but asked at the moment the language is picked** — inline on the language screen, not as up to 4 separate screens. Tapping a language expands a single compact `A1 A2 B1 B2 C1 C2` row under it; picking a level collapses it back to `🇩🇪 Deutsch · B1 ✅`. Same posture as `/settings`, which already asks for the level when a language is added (`settings.helper.ts:210`). |
| 3a | Making the level earn its taps | Today `proficiency_level` only feeds video-vocabulary extraction — the translation pipeline ignores it. If we keep charging the user taps for it, it must drive output (level-appropriate examples, synonym register, explanation depth). Tracked as a follow-up, see Open Questions. |
| 4 | Demo card | **Pre-generated, curated "hook" cards per learning language**, served from cache — instant. Free-text input stays available as a secondary path with a real progress indicator. |
| 5 | Demo card generation | Curated headword list in the repo; cards generated per `(headword, nativeLang)` by a warm-up script and cached in a new table. Cache miss → live pipeline with progress, then written to cache. |
| 6 | Keyboards | 2–3 columns instead of one button per row. |
| 7 | Final screen | Feature instruction with **inline buttons**, not slash commands. Optional 15–20 s screencast (animation) when an asset is configured. |
| 8 | Activation nudge | One D+1 message if the user never translated anything after finishing onboarding. Not a series. |
| 9 | Instrumentation | Step + outcome events for every screen, with timestamps. Ships **first**, so before/after is measurable. |

---

## New Flow

### Screen 0 — Hook + native language (1 tap)

```
🌍 Polyglot — переводчик, который объясняет.

Не просто слово, а значения, примеры, нюансы и то,
как это реально говорят носители.

Настройка — 30 секунд.

Вы говорите по-русски?
[ ✅ Да, русский ]
[ 🌐 Другой язык ]
```

- Language name comes from `ctx.from.language_code` via `languageCache.getLangDisplay()`.
- "Другой язык" expands the full supported list in a 2-column keyboard.
- If `language_code` is missing or unsupported → skip straight to the picker.

### Screen 1 — Learning languages + level (2 taps per language)

One screen, one message, edited in place. Multi-select as today, but the CEFR level is
asked **inline at the moment the language is picked** — never as a separate screen.

```
📚 Какие языки вы изучаете?

[ 🇩🇪 Deutsch ]      [ 🇬🇧 English ]
[ 🇨🇿 Čeština ]      [ 🇪🇸 Español ]
                 …
```

Tap `🇩🇪 Deutsch` → the row expands in place:

```
📚 Какие языки вы изучаете?

🇩🇪 Deutsch — ваш уровень?
[ A1 ] [ A2 ] [ B1 ] [ B2 ] [ C1 ] [ C2 ]
[ 🤷 Не знаю ]

[ 🇬🇧 English ]      [ 🇨🇿 Čeština ]
                 …
```

Tap `B1` → collapses back into the list as a selected chip, and the language keyboard
returns:

```
✅ 🇩🇪 Deutsch · B1

[ 🇬🇧 English ]      [ 🇨🇿 Čeština ]
                 …
[ ✅ Готово ]
```

Rules:

- 2-column language keyboard; the 6 level buttons fit **one row** (compact `A1`…`C2`
  labels — the long `"A1 — Beginner"` labels of `LEVEL_LABELS` are what forced one button
  per row today). The full wording moves into the prompt text above the row.
- **"🤷 Не знаю"** is a first-class answer → stores the `B1` default. Most people genuinely
  do not know their CEFR level, and a dead end there is worse than a slightly wrong level.
- Re-tapping a selected language re-opens its level row (change or deselect) — no separate
  edit flow.
- `Готово` appears once at least one language has a level. A language can never end up
  selected without a level, so there is no reconciliation step later.
- Taps: 2 per language (language + level) instead of today's 1 + a full screen. For the
  typical single-language user that is **2 taps on 1 screen** versus **2 taps on 2 screens**,
  and for a 4-language user 8 taps on 1 screen versus 8 taps on 5 screens.
- The moment the first language is confirmed the copy previews the payoff:
  *"Отлично. Сейчас покажу, на что это похоже."*

### Screen 2 — Instant wow (1 tap, no typing)

```
Попробуйте — это займёт секунду 👇

[ 🇩🇪 Backpfeifengesicht ]
[ 🇩🇪 doch ]
[ 🇩🇪 verschlimmbessern ]

…или просто пришлите любое слово или фразу.
```

- Tapping a hook word renders the **real card format** (`renderTranslation`) from cache —
  no waiting.
- Typing a word runs the real pipeline. Because p50 is ~7 s and p95 ~23 s
  (see `project_translation-latency-profile` notes), this path **must** show a typing
  indicator plus a phase-updating "готовлю карточку…" message, reusing the existing
  translate-mode loader.
- After the first card is shown, a follow-up nudge: *"Хотите ещё? Просто пришлите слово."*

#### Hook-word curation rules

Each learning language gets 3 headwords chosen to demonstrate what a plain dictionary
cannot do:

| Type | Purpose | Examples |
|------|---------|----------|
| Untranslatable concept | Shows cultural/semantic explanation | 🇩🇪 `Backpfeifengesicht`, 🇪🇸 `sobremesa`, 🇨🇿 `prozvonit` |
| Idiom | Shows that literal translation breaks | 🇬🇧 `it's not my cup of tea`, 🇫🇷 `avoir le cafard` |
| Language quirk | Shows real command of the language | 🇨🇿 `strč prst skrz krk`, 🇩🇪 `doch` |

Curation constraints: no vulgarity, no politics, no culturally loaded jokes; the humour
must survive translation into every interface language. Every generated card is reviewed
once before being marked active — these are the first thing a new user ever sees.

### Screen 3 — Instruction + feature entry points

```
Готово 🎉 Как этим пользоваться:

1️⃣ Пришлите слово или фразу — вернётся карточка
2️⃣ Кнопки под карточкой: другое значение, уточнить, сохранить
3️⃣ Сохранённые слова сами вернутся на повторение

[ 📖 Мой словарь ]   [ 🎯 Тренировка ]
[ 🎬 Видео ]         [ ⚙️ Настройки ]
```

- Optional: a 15–20 s screencast sent as an animation immediately above this message,
  showing word → card → save → notification. Gated behind an env/system-setting holding a
  Telegram `file_id`; absent → text-only, no error. **The video asset itself is not
  produced by this task.**
- Buttons route to the existing scenes; no new feature surface.

---

## Data Model

New table, `packages/adapters/db/src/schema.ts`:

```ts
export const onboardingDemoCards = pgTable(
  "onboarding_demo_cards",
  {
    id: serial("id").primaryKey(),
    /** Learning language the headword belongs to (ISO 639-1). */
    sourceLang: text("source_lang").notNull(),
    /** Native language the card was rendered for (ISO 639-1). */
    nativeLang: text("native_lang").notNull(),
    headword: text("headword").notNull(),
    /** Serialized TranslateOutput (packages/core/src/modules/translation/types.ts:283). */
    payload: jsonb("payload").notNull(),
    /** Ordering within the hook keyboard. */
    sortOrder: integer("sort_order").default(0).notNull(),
    /** Reviewed and safe to show. Unreviewed cards are never served. */
    isActive: boolean("is_active").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("onboarding_demo_cards_key_idx").on(table.sourceLang, table.nativeLang, table.headword)],
);
```

Headword list lives in code (`packages/core/src/modules/onboarding/hook-words.ts`) as the
source of truth; the table caches rendered cards per native language.

Warm-up: a script generating cards for the pairs that matter first
(`native ∈ {ru, en, cs}` × all supported learning languages). Other pairs fall back to
live generation on first use and are cached afterwards.

Migration via `pnpm db:generate` + `pnpm db:push` (never `db:migrate` on `develop`).

---

## Instrumentation (ships first)

Extend onboarding step tracking so every screen is recorded:

- `updateOnboardingStep` called on **entry to each screen**, not only steps 1–2.
- Record the demo outcome distinctly: `hook_tapped` / `typed_word` / `abandoned`.
- Prometheus counter `bot_onboarding_step_total{step,outcome}` following the
  `bot_unrecognized_word_total` pattern from Task 70.
- Funnel query for the admin panel: users grouped by furthest step reached, split by
  onboarded true/false.

Without this the redesign cannot be evaluated.

---

## Activation Nudge (D+1)

- Daily in-process cron, mirroring `apps/bot/src/retention.wiring.ts` (node-cron) and the
  notification scheduler.
- Condition: `onboarded = true`, onboarding completed ≥ 24 h ago, zero rows in
  `translation_requests` for that user since completion, nudge not yet sent.
- One message: a hook word for one of their learning languages + a tap-to-see-card button.
- Recorded in `notification_history` so it can never fire twice.

---

## Implementation Slices

Each slice is independently shippable and independently verifiable.

| # | Slice | Files |
|---|-------|-------|
| 1 | Full step instrumentation + funnel query | `onboarding.scene.ts`, `user.repository.ts`, metrics module, admin panel |
| 2 | Fold the CEFR question into the language screen (inline level row, compact labels, "🤷 Не знаю"); 2-column keyboards | `onboarding.scene.ts`, locales |
| 3 | Native-language guess from Telegram locale | `onboarding.scene.ts`, locales |
| 4 | `onboarding_demo_cards` table + hook-word list + warm-up script | `schema.ts`, `packages/core/src/modules/onboarding/`, `packages/adapters/db/src/repositories/` |
| 5 | Real demo card: hook buttons (cached) + typed word (live pipeline with progress) | `onboarding.scene.ts`, `translation.renderer.ts`, `translate-flow.ts` |
| 6 | Final instruction screen with inline buttons + optional animation | `onboarding.scene.ts`, `commands.ts`, locales |
| 7 | Move the flow out of the grammY conversation → stateless handlers | `onboarding.scene.ts` → new handler module, `start.ts`, `stale-onboarding.helper.ts` (becomes obsolete), `bot-factory.ts` |
| 8 | D+1 activation nudge | new wiring module mirroring `retention.wiring.ts`, `notification_history` |

Slices 1–6 land inside the existing conversation and deliver most of the conversion win.
Slice 7 is the structural cleanup and can follow once 1–6 are proven. Slice 8 is retention,
not activation, and is last.

---

## Acceptance Criteria

- [ ] `/start` → real rendered card in 5 taps for one learning language, with no free-text input required
- [ ] Every extra learning language costs 2 taps and 0 extra screens
- [ ] Hook cards render instantly from cache (no AI call on the tap path)
- [ ] Typed-word demo runs the real pipeline, with a typing indicator and a progress message
- [ ] Demo failure degrades gracefully: apologetic copy, onboarding still completes
- [ ] `demoResult` placeholder key removed from all 11 locale files
- [ ] CEFR level is asked inline on the language screen; no dedicated level screen exists
- [ ] A learning language can never be saved without a level; "🤷 Не знаю" persists the `B1` default
- [ ] Re-tapping a selected language re-opens its level row (change or deselect)
- [ ] Levels remain settable in `/settings` exactly as today
- [ ] Native language pre-filled from Telegram locale, full picker one tap away
- [ ] All language keyboards are 2–3 columns
- [ ] Final screen lists features as inline buttons that route to the existing scenes
- [ ] Screencast sent only when the asset is configured; its absence is not an error
- [ ] Every screen writes an onboarding step/outcome event
- [ ] Only reviewed (`is_active = true`) demo cards are ever served
- [ ] After slice 7: no grammY conversation in the onboarding path; a 10-minute pause does not produce dead buttons and does not restart the flow from step 1

## Tests

Derived from the spec, behaviour-level (per `@docs/agents/testing-strategy-tdd.md`):

- Locale-guess path: supported `language_code` → confirmation screen; unsupported/missing → picker
- Language tap → level row expands in the same message; level tap → collapses to `lang · level`
- "🤷 Не знаю" persists `B1` and is indistinguishable downstream from an explicit `B1`
- `Готово` is unavailable until at least one language has a level
- Re-tapping a confirmed language re-opens its level row and allows deselection
- Four languages selected → all four levels persisted via `setLanguageLevel`, still one screen
- Hook tap → card rendered from cache, no AI adapter call
- Cache miss → pipeline called once, result persisted, card rendered
- Pipeline error during the typed demo → error copy shown **and** `markOnboarded` still called
- Inactive demo cards are never served
- Step events written for every screen, including abandonment
- Tap count from `/start` to first card ≤ 4 in the happy path (integration test through the
  grammY harness — note the fetch-level mock/entity gotchas recorded in Task 71)
- D+1 nudge: fires once for an inactive user, never for a user who translated, never twice

## Out of Scope

- Producing the screencast asset
- Paid-tier upsell inside onboarding
- Reworking `/settings`
- Changing the translation pipeline or card layout itself

## Open Questions

1. **Value-first variant.** A more aggressive flow — `/start` → "пришлите слово" → card →
   *then* ask about languages (guessing everything from the Telegram locale) — usually
   converts better still, but it is a rewrite rather than a redesign and it changes what
   `onboarded` means. Decide before slice 7, since slice 7 is where the flow's state model
   is rewritten anyway.
2. **Hook words per language** need a final curated list (3 × 10 supported languages = 30
   headwords) and a review pass.
3. **Make the level drive the output (separate task).** We now ask for the level up front,
   so it has to pay for itself: level-appropriate examples, synonym register, and
   explanation depth in the translation prompt. Until that lands, the question is a
   promise the product does not keep. Candidate follow-up alongside
   `@docs/tasks/translation-quality-program.md`.
4. **Self-correction over time.** Once the level shapes output, consider nudging it from
   behaviour ("эти слова для B1 простоваты — поднять уровень?") instead of leaving whatever
   was tapped on day one — especially for the "🤷 Не знаю" cohort.
