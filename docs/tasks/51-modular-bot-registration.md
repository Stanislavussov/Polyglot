# Task 51 — Modular Bot Feature Registration

**Status:** 🔲 To Do  
**Category:** Architecture — Medium  

---

## Goal

Replace the 52 sequential `bot.callbackQuery()` / `bot.command()` registrations in `apps/bot/src/index.ts` with a modular feature plugin system. The current file is 234 lines of procedural registration that grows linearly with every new feature.

## Problem Analysis

```typescript
// apps/bot/src/index.ts — 52 registration calls
bot.command("start", startCommand);
bot.command("translate", handleTranslateCommand);
// ...5 more commands

bot.callbackQuery("set:native", handleSetNativeCallback);
bot.callbackQuery(/^set:native:/, handleSetNativeSelectCallback);
// ...14 more settings callbacks

bot.callbackQuery("tr:save", handleSaveCallback);
// ...3 more translate callbacks

bot.callbackQuery("fc:start", handleFcStart);
// ...6 more flashcard callbacks

bot.callbackQuery(/^dict:page:/, handleDictPage);
// ...5 more dictionary callbacks

bot.callbackQuery("tpl:customize", handleCustomizeCallback);
// ...5 more template callbacks

bot.callbackQuery("notif:open", handleNotifOpenCallback);
// ...1 more notification callback
```

Adding SRS, quizzes, and topics will each add 5-10 more callbacks, pushing this file past 300+ lines and 80+ registrations.

## Required Behavior

Group related handlers into **feature modules** that self-register their commands and callbacks on a provided Bot instance.

## Acceptance Criteria

- [ ] Feature module pattern established: `registerXxxFeature(bot: Bot<BotContext>): void`
- [ ] `apps/bot/src/features/settings.feature.ts` — groups all 16 settings callbacks
- [ ] `apps/bot/src/features/translate.feature.ts` — groups translate commands + 4 callbacks
- [ ] `apps/bot/src/features/flashcard.feature.ts` — groups flashcard command + 7 callbacks
- [ ] `apps/bot/src/features/dictionary.feature.ts` — groups dictionary command + 6 callbacks
- [ ] `apps/bot/src/features/template.feature.ts` — groups template command + 6 callbacks
- [ ] `apps/bot/src/features/notification.feature.ts` — groups notification callbacks
- [ ] `apps/bot/src/index.ts` reduced to: middleware setup + feature registration loop + bot.start()
- [ ] Registration order preserved (commands before callbacks, mode router last)
- [ ] All existing tests pass — pure refactor
- [ ] `index.ts` reduced to < 80 lines

## Dependencies

None

## Effort Estimate

2–3 hours (create feature files: 1.5h, refactor index.ts: 0.5h, verify tests: 1h)

## Files Likely Affected

- `apps/bot/src/features/` — NEW directory
- `apps/bot/src/features/settings.feature.ts` — NEW
- `apps/bot/src/features/translate.feature.ts` — NEW
- `apps/bot/src/features/flashcard.feature.ts` — NEW
- `apps/bot/src/features/dictionary.feature.ts` — NEW
- `apps/bot/src/features/template.feature.ts` — NEW
- `apps/bot/src/features/notification.feature.ts` — NEW
- `apps/bot/src/index.ts` — dramatically simplified
