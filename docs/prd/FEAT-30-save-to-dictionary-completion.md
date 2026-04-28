# PRD: FEAT-30 — Save to Dictionary (Completion)

## Problem Statement

A person speaks their native language and is simultaneously learning 2+ foreign languages. When studying new vocabulary, a recurring problem arises: they know a word in one language but forget it in another. Polyglot solves this by allowing users to save words across all learning languages simultaneously with one tap.

The current save mechanism exists, but it lacks:

- **Referential integrity** — source language is stored as text instead of a proper database reference
- **Input type tracking** — no differentiation between saving a word vs a phrase
- **Duplicate detection** — users can silently create duplicate entries for the same word
- **Content quality** — internal AI pipeline metadata is stored alongside user-facing content

Without these, the personal dictionary is unreliable for future review features and pollutes the data model.

---

## Solution

A complete save-to-dictionary flow that persists AI translation output as personal vocabulary entries with:

1. **One-tap save** via Telegram inline button — no confirmation dialog
2. **Referential integrity** — source language stored as a proper foreign key reference
3. **Input type metadata** — tracking whether the saved item is a word or phrase for future quiz differentiation
4. **Duplicate prevention** — user receives clear "Already in dictionary" feedback when attempting to save a duplicate
5. **Clean content storage** — only user-facing learning content is stored
6. **Post-save refinement** — translation regeneration buttons remain active after saving to allow improvement

---

## User Stories

### Core Save Flow

1. As a language learner, I want to tap a Save button on a translation card, so that the word/phrase is stored in my personal dictionary immediately without any confirmation dialog.

2. As a language learner, I want the Save button label to clearly indicate what I'm saving, so that I have feedback about the entry type being added.

3. As a language learner, I want to be told when I try to save a word that already exists in my dictionary, so that my dictionary stays clean and I don't review the same word twice.

4. As a language learner, I want to be able to improve my saved translations after saving, so that I can refine entries I'm not satisfied with.

5. As a language learner, I want my saved words to include CEFR level, register, synonyms, and examples, so that I have rich context for learning.

### Data Integrity

6. As a language learner, I want my dictionary to track whether I saved a word or a phrase, so that future quizzes can offer appropriate question types.

7. As a language learner, I want sentence translations to NOT have a Save button, so that I'm not tempted to save non-vocabulary content.

8. As a developer, I want the database to enforce referential integrity for language references, so that orphaned references are prevented at the database level.

9. As a developer, I want saved dictionary entries to contain only user-facing content, so that internal AI pipeline metadata doesn't pollute user records.

### Post-Save Experience

10. As a language learner, I want regeneration buttons to remain after saving, so that I can improve specific language translations without losing my saved entry.

11. As a language learner, I want to see a confirmation after saving, so that I know the action succeeded.

12. As a language learner, I want my saved entries to be immediately available for future review and notification features, so that I can start learning without additional steps.

---

## Implementation Decisions

### Data Integrity

- Source language must be stored as a proper database reference, not free text
- Duplicate detection must prevent the same word from being saved twice by the same user in the same source language
- Saved content must be limited to user-facing learning data — internal pipeline metadata excluded

### Save Flow

- Save is triggered by a single inline button tap — no multi-step confirmation
- Duplicate saves show a clear user-facing message and prevent creation of duplicate entries
- After saving, the user sees a confirmation and the keyboard transitions to allow refinement of individual translations

### Input Type Handling

- Words and phrases can be saved to the dictionary
- Sentences cannot be saved — they have no Save button
- The save operation records whether the saved item was a word or phrase for future differentiation

### Translation Refinement

- After saving, regeneration buttons for each language remain active
- Regenerating a translation on a saved entry updates the saved entry automatically
- No re-save action is required after refinement

---

## Testing Decisions

### What Makes a Good Test

- Test external behavior — the outcome of actions, not internal implementation details
- Test user-facing feedback — confirmations, error messages, button states
- Test data integrity — what gets stored and how duplicates are handled

### Areas to Test

| Area            | What to Test                                                                   |
| --------------- | ------------------------------------------------------------------------------ |
| Save flow       | One-tap save stores entry, duplicate shows error message, confirmation appears |
| Keyboard states | Post-save keyboard shows refinement options, no duplicate save button          |
| Content storage | Saved entries contain only user-facing fields                                  |
| Regeneration    | Refining a translation on a saved entry updates the saved entry                |
| Input type      | Word and phrase save correctly; sentence has no save option                    |

### Prior Art

Existing tests in the codebase cover similar callback handlers, keyboard builders, and repository operations. Follow the same patterns for consistency.

---

## Out of Scope

| Feature                              | Rationale                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------- |
| Dictionary browse and search         | Separate feature. Users can save without browsing in this release.         |
| Spaced repetition scheduling         | Depends on SRS subsystem. Triggers on save are deferred.                   |
| Save to topics or collections        | Requires topic module. Defer to future milestone.                          |
| Edit saved translation               | User override capability deferred pending clarification.                   |
| Per-language save buttons            | Conflicts with multi-language simultaneous save — the core differentiator. |
| Case-insensitive duplicate detection | Edge case. Most users won't encounter it in early use.                     |
| Audio pronunciation                  | Telegram poor fit. Defer to native app.                                    |

---

## Further Notes

### Open Questions Resolved

| Decision                    | Choice Made                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Database migration approach | Add reference column as nullable, backfill existing data, then enforce. Old text column retained temporarily. |
| Duplicate save behavior     | Show "Already saved" message and stop. No silent update.                                                      |
| Phrase card layout          | Same layout as word cards. Button label indicates type only.                                                  |
| Post-save regeneration      | Automatically updates the saved entry. No re-save prompt needed.                                              |
| Existing data               | Defaulted to word type. Acceptable approximation.                                                             |

### Dependencies

- Input type detection must be working before this feature (words, phrases, sentences classified correctly)
- Dictionary browse feature depends on this being complete

### Success Criteria

A user can:

1. Translate any word or phrase in multi-language mode
2. Save it with one tap
3. See confirmation of the save
4. See an error message if the word was already saved
5. Improve saved translations after saving
6. Have entries ready for future review features
