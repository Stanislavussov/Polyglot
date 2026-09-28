# Task 86: A word notification is a card — one or several — with a way out of notifications on each

Type: Feature.
Status: done.

## Problem

A scheduled notification carries exactly one word, and its grades (Hard / OK / Easy) only
reweight the word for later notifications — they never move its SM-2 schedule. Cards rate the
same words with a different set (Again / Hard / Good / Easy), so one word had two grading
vocabularies, and two templates (notification, card front) decided how it looked. A reader who
wants to progress faster from the notification has no way to, and a reader who is tired of
notifications has to find `/settings → 🔔 Notifications` on their own.

## Decision

1. **A word from the dictionary is always a card.** Its notification is the Cards front (the
   card-front template decides what it shows) with Reveal and Remove; Reveal turns the same
   message into the `/review` deck — the four SM-2 ratings, the progress line, the finish
   screen. The Hard / OK / Easy grade row is gone from every surface; the separate
   notification template is gone too (`set:ntpl` buttons in history open the card template).
2. A per-user **cards per notification** setting: 1 / 3 / 5 / 10, default 1
   (`user_language_settings.notification_batch_size`). Above 1 the message leads with the count
   and the deck holds that many cards.
3. Every word notification and the lapsed-user message carry a last-row
   **⚙️ Notification settings** button that opens the notification settings screen as a new
   message, leaving the notification itself untouched. That screen gains a *cards per
   notification* row and a *card template* row.
4. A word **not** in the dictionary (curated preset, AI suggestion, contextual sentence) has
   nothing to schedule: it stays a recall prompt whose Reveal translates it.

## Behavior spec

### Choosing what to send (scheduler)

- Every type but `contextual`: the deck picker takes due rows first, then practice-ahead rows, one card per
  entry, skipping words inside the usual de-dup window (`recentWords`), capped at the size.
  The deck's first card is what the message shows, and every card's word is recorded in
  `notification_history` — the shown one last, so it is the "last sent word".
- The picker finds nothing (empty dictionary, everything recently sent) → the single-word
  layers run exactly as today (dictionary → preset → empty-dictionary prompt).
- A `contextual` subscriber keeps the AI sentences they chose; the size applies to the other
  types, and the settings screen hides the size row for them.
- Lapsed-user re-engagement stays one word at a five-day cadence: a person who left is not
  greeted with ten cards.

### The card notification

- Text: a title with the deck size (only above 1), the first card's front (the user's card-front settings,
  as in `/review`), the rotating recall question, the weekly footer when due.
- Buttons: `👁 Reveal` → `notif:deck:{entryId}`; `🗑 Remove` → `notif:learned:{entryId}`
  (restore brings back the same buttons); `⚙️ Notification settings` → `notif:settings`.
- A word the single-word pickers chose (lapsed user, contextual fallback) is sent as a deck of
  one: the entry's own front and the same buttons.
- Tapping Reveal builds the deck **at tap time**: the shown word pinned first, then
  what is due *now*, topped up with practice-ahead, capped at the user's current size. It
  is stored in `session.cards` and the card is revealed — from here it is `/review`.
  - The shown word was removed since → the deck starts from what is due now.
  - Nothing to review at all → toast "no results", buttons cleared.
  - A running `/review` deck is replaced (one deck per chat, as `fc:restart` does).

### Buttons already in chat history

- `notif:reveal:{id}` opens the deck exactly like `notif:deck:{id}`.
- `notif:fb:{grade}:{id}` still stores the grade and upgrades the message to the card's buttons.
- `set:ntpl` and `set:ntpl:t:*` open the card template.

### Settings

- `set:notif:batch` shows 1 / 3 / 5 / 10 (current one marked ✅) and Back.
- `set:notif:batch:{n}` persists `n` only when it is one of the offered sizes; anything else
  writes nothing and re-shows the notification settings.
- The notification settings text shows the current size; the row is shown while
  notifications are enabled.
- `notif:settings` replies with the notification settings screen as a new message; the
  notification it was tapped on is not edited.

### Non-goals

- No admin-panel knob for the size or its options.
- The `user_notification_templates` table and its repository stay until a contract step
  drops them; nothing reads them any more.
- No per-message deck state: the chat's one `cards` slot is reused.

## Tests

- Unit: deck picker (order, de-dup, cap, empty), scheduler (deck vs single path, history for
  every card), formatter/keyboards, settings builders.
- Integration (`notification-deck.integration.test.ts`): scheduler → deck message → Show
  answer → rating writes SM-2 state and advances to 2/N; `notif:settings` opens the settings
  screen as a new message; `set:notif:batch:{n}` persists and a forged size writes nothing.
