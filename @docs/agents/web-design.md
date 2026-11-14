# Web Design Rules (`apps/web`)

Read before any visual change to the website. The owner's direction (2026-11-09):
simple, minimal, large — "broad strokes", sized like the Google Store
(https://store.google.com/ie/?hl=en-GB).

## Principles

0. **The goal is simplicity.** Every screen should be understood at a glance by someone who
   never read a manual. Prefer one plain, friendly sentence over numbers, intervals, counters
   and jargon ("Not reviewed yet", "Time to review", "You know this one well" — never
   "Interval: 3 d · Reviews: 2"). When a detail needs explaining, remove it instead.
1. **Large and calm.** Big type, generous spacing, few elements per screen. When unsure,
   go one step bigger and remove something rather than add.
2. **One thing is the focus.** Each screen and each card has one obvious main element
   (the word, the rating block, the primary button). Everything else is quieter.
3. **No decoration for its own sake.** No arrows, emoji, or ornaments as UI. Icons come
   from `lucide-vue-next`; language flags only through `LangFlag` / `LangBadge`.
4. **Nothing jumps.** Opening a setting, saving, or reloading a card must not shift the
   layout. Settings open in a popover or sheet, never as an inline block that pushes content.
5. **Same thing, same look.** Reuse the shared component instead of restyling in place:
   `LangBadge` for a language label, `.card`, `.btn-primary`, `.btn-secondary`, `.field`,
   `.page-title`, `BottomSheet`.

## Colour

Teal from the owl logo (`#1F8A74`), a mint accent, a cool white canvas. Every value lives in
`apps/web/src/styles/tokens.css`; components use the tokens only. Avoid olive/swamp greens and
plain blue.

## Type scale — the only allowed sizes

| Class | Size | Use |
|---|---|---|
| `text-sm` | 15px | captions, buttons, badges, helper and meta text |
| `text-base` | 17px | all body text: examples, notes, descriptions (the `body` default) |
| `text-xl` | 20px | translation words, block titles |
| `text-2xl` | 24px | big numbers, section headings |
| `text-3xl` | 30px | page titles (`.page-title`), the headword on a card |

`text-xs` and `text-lg` are not used: they create the "every line a different size" look.
Never add arbitrary sizes like `text-[13px]`.

## Layout

- Phone 390px, tablet 820/1180px, desktop 1440px: check all four, no horizontal scroll.
- Tap targets at least 44px high (`min-h-11`) on phones.
- Phone sheets open to at most `75dvh` so the close control stays in thumb reach.
- Page content aligns left like every other page; do not center one page alone.

## Word card kit (`apps/web/src/components/word/`)

Every card that shows a word is assembled from these parts. Do not hand-roll a headword, a
language label or a flag list.

| Part | What it draws | Props |
|---|---|---|
| `WordCard` | Card shell: default slot (top), `aside` (top-right actions), `body`, `footer` | `as`, `flat`, `padding` (`none`/`sm`/`md`), `iconColumn` |
| `IconRow` | The shared layout: icon column + content. Everything below is built on it | `align`, `iconColumn` |
| `WordEyebrow` | Small grey "🇨🇿 ЧЕШСКИЙ" line above a word | `code`, `label`, `flag`, `tone` |
| `WordHeadline` | Emoji + word; `after` slot for sound and chips | `text`, `emoji`, `size` (`md`/`lg`/`xl`), `tone`, `as`, `reserveIcon`, `variant` (`plain`/`chip`) |
| `TranslationLines` | Flag + text per translation | `lines`, `size` (`sm`/`base`/`xl`) |

Sizes and tones live in `apps/web/src/lib/word-card.ts` and map only onto the type scale above.
`WordCard` passes `iconColumn` to every `IconRow` inside it, so the eyebrow flag, the emoji
and the translation flags stay in one column.

```vue
<WordCard as="li">
  <WordEyebrow :code="item.sourceLang" />
  <WordHeadline :text="item.original" :emoji="item.emoji" size="md" />
  <template #aside><button>…</button></template>
  <template #body><TranslationLines :lines="translations" /></template>
  <template #footer>…buttons…</template>
</WordCard>
```

## Action rows (`ActionBar`)

A row of secondary actions is an `ActionBar` (`apps/web/src/components/ActionBar.vue`), fed a
`BarAction[]` in priority order. Actions fit in the row while there is room; the rest fold into
"⋯". The "⋯" menu never holds a single action. Phones show icons only, desktop adds labels.
The one primary action (for example "Open") sits outside the bar, bottom-right, under a
right-handed thumb. A destructive action goes last, so it is the first to fold away.

## Text input (`ComposerCard`)

Every free-text box (translate, the mentor) is a `ComposerCard`: the same field, counter, Clear,
Enter-to-send, and a thumb-reach submit button on phones. Extra buttons go in its `tools` slot.

## Loading inside a card

A paragraph that is still loading inside a card shows `MonsterLoader inline` (a small monster
beside text-shaped lines), never a bare "Working…".
