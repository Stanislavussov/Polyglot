# Task 36 — Fix Onboarding Back-Navigation

## Goal

Pressing "Back" during onboarding steps doesn't reliably return the user to the previous step. The conversation gets stuck or produces confusing duplicate messages.

## Problem Analysis

In `apps/bot/src/scenes/onboarding.scene.ts`, the `while (step <= 3)` loop re-calls step functions when `BACK` is returned. Issues:

1. **Old keyboards linger**: When going back from step 2 → step 1, the step 2 message (with its inline keyboard) remains visible. The user may tap stale buttons that match the `waitForCallbackQuery` filter of the re-entered step, causing unexpected behavior.
2. **State not cleaned up on back**: When returning from step 2 to step 1, the previously displayed "✅ lang" confirmation from step 1 still shows. Re-entering step 1 sends a brand-new message, leaving the old confirmed message confusing.
3. **Learning language selection resets**: Going step 3 → step 2 resets `selected[]` to empty, discarding previous selections.

## Acceptance Criteria

- [ ] When user presses Back, the _current_ step's message (with keyboard) is deleted or its keyboard is removed before re-entering the previous step
- [ ] Going step 3 → step 2 preserves previously selected learning languages (pass them in or persist via session/external)
- [ ] Going step 2 → step 1 clears step 2's keyboard message
- [ ] Full round-trip works: step 1 → step 2 → back → step 1 → step 2 → step 3 → back → step 2 → step 3 → done
- [ ] Existing onboarding test passes; add a test case for back-navigation round-trip

## Dependencies

None

## Effort Estimate

3–4 hours

## Files Likely Affected

- `apps/bot/src/scenes/onboarding.scene.ts` — store message IDs per step, delete/edit on back, pass state to re-entered steps
- `apps/bot/src/__tests__/onboarding.scene.test.ts` — add back-navigation test
