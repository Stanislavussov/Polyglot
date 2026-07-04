# T10 — Redact PII/текстов в pino

- **Приоритет:** P1 (High — PII третьей стороне)
- **Фаза:** 1 — Безопасность
- **Оценка:** ~0.5 дня
- **Зависит от:** —
- **Блокирует:** —
- **Связано:** [T05](T05-admin-login-rate-limit.md) (логи неудачных логинов)
- **Находки:** S7

## Проблема

`packages/core/src/logger.ts:16` — `pino({ level: "info" })`, `redact` не настроен. На уровне info+ логируются фрагменты пользовательских сообщений и идентификаторы: `apps/bot/src/middlewares/mode-router.ts:70,112` (текст, userId), `scenes/helpers/mentor-mode.helper.ts:100` (`text.slice(0,50)`), `middlewares/auth.ts:29` (telegramId/username при создании пользователя). Секреты в логи не попадают (проверено), но переписка пользователей — это PII, экспортируемая в Betterstack/Loki третьей стороне.

## Затронутые файлы

- `packages/core/src/logger.ts:16`.
- `apps/bot/src/middlewares/mode-router.ts:70,112`.
- `apps/bot/src/scenes/helpers/mentor-mode.helper.ts:100`.
- `apps/bot/src/middlewares/auth.ts:29`.

## Решение

1. Настроить `redact` в pino для чувствительных путей и/или убрать тексты сообщений из info-логов — оставить длины/хэши/категории.
2. Debug-логи с текстом — только на уровне debug и только локально (не уходят в Betterstack на проде).
3. Договориться о политике: что считается PII (текст, username), как долго хранится в Loki (координация с retention [T25](T25-telemetry-retention-timezone.md)).

## Критерии приёмки

- [ ] На проде (level info) тексты сообщений и username не попадают в лог/Betterstack.
- [ ] Диагностическая ценность сохранена (длины/хэши/категории есть).

## Тесты (spec-first)

- Unit-тест логгера: объект с полем-текстом на info выводится с redacted-значением; на debug (локально) — полностью.

## Примечания

Дёшево и снижает регуляторный риск. Согласовать список redact-путей с командой.
