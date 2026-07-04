# T24 — Фундамент мультиканальности: identities + нейтральный userId

- **Приоритет:** P2 (Medium — стратегическая расширяемость)
- **Фаза:** 3 — Архитектурные инвестиции
- **Оценка:** ~5 дней
- **Зависит от:** [T21](T21-single-source-of-truth.md) (чистый источник настроек)
- **Блокирует:** [T28](T28-dep-cruiser-allowlist.md)
- **Связано:** [T23](T23-translate-pipeline.md)
- **Находки:** A1, A13, A18

## Проблема

Telegram-идентичность вшита в стабильные слои — новый канал (WhatsApp/web) потребует правки ядра, а не нового адаптера:

- **A1:** `telegramId`/`findByTelegramId` в core-портах (`user.repository.ts:9,20,49`, `notification.repository.ts:8`), `SendFn = (telegramId, …)` (`adapters/notifications/src/types.ts:12`). Канал доставки — внешняя вариация, но его идентификатор является первичной идентичностью пользователя в домене (нарушение Protected Variations).
- **A18:** `infra` требует `BOT_TOKEN` для любого приложения и делает `process.exit(1)` из библиотеки (`config.ts:8,44`).
- **A13:** «Telegram bot» в core-промптах / локализованные строки из домена (частично закрыто [T23](T23-translate-pipeline.md)).

## Затронутые файлы

- `packages/core/src/ports/user.repository.ts:9,20,49`, `packages/core/src/ports/notification.repository.ts:8`.
- `packages/adapters/notifications/src/types.ts:12`.
- `packages/infra/src/config.ts:8,44`.
- Схема БД (новая таблица identities), миграция.

## Решение

1. Ввести в домене нейтральный `userId` как единственную идентичность; связку «канал → внешний id» вынести в таблицу/порт `identities (userId, channel, externalId)`.
2. `SendFn` принимает `userId`; резолвинг externalId делает канал-адаптер.
3. `infra`: env-схему сделать составной (`baseEnv` + канальные расширения, каждое приложение собирает свою); `loadConfig` бросает типизированную ошибку, `process.exit` — только в точке входа приложения.
4. Промпты: канал передавать параметром (`channelHint`), а не хардкодить «Telegram».

## Критерии приёмки

- [ ] Домен оперирует `userId`, не `telegramId`; связь с каналом — в identities.
- [ ] Приложение без Telegram может использовать infra без `BOT_TOKEN`.
- [ ] Промпты не содержат хардкод «Telegram bot».

## Тесты (spec-first)

- Тест резолвинга identities: `userId` ↔ `(channel, externalId)`.
- Тест составной env-схемы: admin/worker стартует без `BOT_TOKEN`.

## Примечания

Дорогой стратегический рефактор — оправдан только если мультиканальность в планах. Требует чистого источника настроек [T21](T21-single-source-of-truth.md) и вынесенной локализации [T23](T23-translate-pipeline.md). Схема БД → drizzle-kit workflow.
