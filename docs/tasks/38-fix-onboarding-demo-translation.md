# Task 38 — Fix Onboarding Demo Translation (Show Real AI Result)

## Goal

After onboarding step 3, the user enters a word but sees a static placeholder instead of a real AI translation. The "wow moment" is lost.

## Problem Analysis

In `apps/bot/src/scenes/onboarding.scene.ts`, `stepDemoTranslation()` does:

```ts
const resultText = t("demoResult", interfaceLang, { word });
await ctx.reply(resultText, { parse_mode: "Markdown" });
```

The `demoResult` i18n string is a static template:
```
"Here's your translation card:\n\n🔤 *{word}*\n\n_(AI translation will appear here once connected)_"
```

This never calls the actual translation pipeline. The user's first interaction with the bot shows a fake placeholder, which is a terrible first impression.

## Required Behavior

Step 3 should:
1. Accept the user's word input
2. Call the real translation pipeline (`translateWithContext`) using the user's configured native + learning languages
3. Render the result with `renderTranslation()` (same as translate mode)
4. Show the card (read-only — no Save/Skip during onboarding demo)

## Acceptance Criteria

- [ ] Onboarding step 3 calls the real AI translation pipeline
- [ ] Translation uses the user's just-configured native lang (source) and learning langs (targets)
- [ ] Result is rendered with `renderTranslation()` in HTML mode (not Markdown placeholder)
- [ ] A loading indicator is shown while translation is in progress
- [ ] On translation error, show a graceful error message and still complete onboarding
- [ ] No Save/Skip buttons — demo is read-only (keep current behavior of no interaction buttons)
- [ ] Update/remove the `demoResult` i18n key or repurpose it
- [ ] Back button still works during the "enter a word" phase (before translation starts)
- [ ] Onboarding completes normally after demo card is shown

## Dependencies

- None (translation pipeline already exists in `translate-mode.helper.ts`)

## Effort Estimate

3–4 hours

## Files Likely Affected

- `apps/bot/src/scenes/onboarding.scene.ts` — `stepDemoTranslation()`: add AI call, render real card
- `packages/core/src/modules/i18n/locales/en.json` — update/remove `demoResult`
- `packages/core/src/modules/i18n/locales/ru.json` — update/remove `demoResult`
- `packages/core/src/modules/i18n/locales/cs.json` — update/remove `demoResult`
