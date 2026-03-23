# BUG-01: Onboarding Implements 4 Steps — BRD Mandates Maximum 3

**Severity:** 🔴 Critical  
**Source Task:** Task 03 (`docs/tasks/03-bot-setup.md`)  
**BRD Reference:** §5 Onboarding  
**Status:** 🔲 Open

---

## Problem

Task 03 implements a **4-step onboarding flow**:

1. "Which language to continue in?" (interface/UI language)
2. "What is your native language?"
3. "Which languages are you learning?"
4. Demo translation + "Save to dictionary?" with [Yes] [No]

The BRD §5 mandates **maximum 3 steps**:

| Step | Question |
|------|----------|
| 1 | What is your native language? |
| 2 | Which languages are you learning? (select 1–4) |
| 3 | Demo translation — user enters any word and **immediately sees the result** |

The BRD does **not** include an interface language selection step. It also describes Step 3 as the "aha moment" — the user sees real product value before registration is complete.

Additionally, the Save/Skip prompt at the end of Step 4 in Task 03 adds friction that contradicts the BRD's intent for the demo step.

---

## Root Cause

Task 03 added an interface language selection step (Step 1) that has no corresponding BRD requirement. The BRD shows native language first, not UI language. The demo step in Task 03 also adds a Save confirmation that isn't described in the BRD's onboarding section.

---

## Files Affected

- `apps/bot/src/scenes/onboarding.scene.ts` — 4-step flow defined here
- `apps/bot/src/commands/start.ts` — triggers onboarding
- `packages/adapters/db/src/repositories/user.repository.ts` — `updateOnboardingStep()` and `markOnboarded()` may need step count updates

---

## Acceptance Criteria

- [ ] Onboarding consists of exactly **3 steps**, no more
- [ ] **Step 1:** "What is your native language?" — inline keyboard with language options
- [ ] **Step 2:** "Which languages are you learning?" — multi-select, 1–4 languages, ✅ Done button
- [ ] **Step 3:** Demo translation — user enters a word, bot shows a real AI translation result; step ends immediately after the result is displayed (no Save/Skip prompt)
- [ ] Interface language (UI language) is inferred from native language or Telegram locale — it is **not** a separate onboarding step
- [ ] `onboarded = true` is set after Step 3 completes
- [ ] All onboarding-related i18n keys updated to reflect 3 steps
- [ ] Existing tests updated to reflect 3-step flow
- [ ] `pnpm test` passes; `pnpm -r run build` succeeds

---

## Notes

- If interface language selection is genuinely needed, it should be moved to `/settings`, not onboarding
- The BRD's metric "Onboarding completion rate > 70% reach Step 3" aligns with the 3-step definition
