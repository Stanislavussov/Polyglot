# T14 — Устойчивость к Telegram 429/403

- **Приоритет:** P1 (High)
- **Фаза:** 2 — Устойчивость и наблюдаемость
- **Оценка:** ~1.5 дня
- **Зависит от:** —
- **Блокирует:** —
- **Связано:** [T15](T15-safe-bot-catch.md), [T12](T12-readiness-and-alerts.md)
- **Находки:** B4, B5

## Проблема

- **429:** ни `@grammyjs/auto-retry`, ни throttler в проекте нет. Любой `sendMessage` при flood-limit бросается и апдейт теряется. Особенно опасно в нотификациях: `scheduler.ts` рассылает пачки раз в час без троттлинга.
- **403 (пользователь заблокировал бота):** `notification.wiring.ts:97-113` + `scheduler.ts:219` логируют ошибку и продолжают, но 403 не распознаётся — `sendWithRetry` бессмысленно ретраит перманентную ошибку, юзер остаётся в рассылке навсегда. `deps.disableNotifications` существует, но вызывается только для inactive-флоу.

## Затронутые файлы

- `apps/bot/src/bot-factory.ts` — `bot.api.config.use`.
- `apps/bot/src/notifications/notification.wiring.ts:97-113`.
- `apps/bot/src/notifications/scheduler.ts:219`.

## Решение

1. Подключить `@grammyjs/auto-retry` + throttler (`@grammyjs/transformer-throttler`) на `bot.api` (и на `Api`, используемый в `notification.wiring.ts`) — автоматический бэкофф на 429.
2. При `error_code === 403` (bot blocked) — вызывать `disableNotifications` для пользователя, не ретраить.
3. Троттлить пакетную рассылку в `scheduler.ts`.

## Критерии приёмки

- [ ] 429 обрабатывается бэкоффом, апдейт/отправка не теряются.
- [ ] 403 → пользователь исключается из рассылки (`disableNotifications`), без повторных ретраев.
- [ ] Пакетная рассылка не упирается в flood-limit.

## Тесты (spec-first)

- Тест: мок Telegram API возвращает 429 → вызов ретраится и в итоге успешен.
- Тест: 403 при отправке уведомления → `disableNotifications` вызван, ретраев нет.

## Примечания

Классификация ошибок пересекается с безопасным `bot.catch` [T15](T15-safe-bot-catch.md) — согласовать различение `GrammyError`/`HttpError` в одном месте.
