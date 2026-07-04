# T18 — Устранить гонки check-then-insert

- **Приоритет:** P1 (High)
- **Фаза:** 2 — Устойчивость и наблюдаемость
- **Оценка:** ~1.5 дня
- **Зависит от:** —
- **Блокирует:** —
- **Связано:** [T04](T04-vocab-unique-index-soft-delete.md) (общая опора на констрейнты)
- **Находки:** E4, E8, E9

## Проблема

Повсеместный паттерн «select → insert» без опоры на уникальные констрейнты даёт гонки:

- **E4:** `apps/bot/src/middlewares/auth.ts:22-29` — `findByTelegramId` → `create`. Telegram шлёт апдейты параллельно (несколько сообщений/callback подряд от нового пользователя) → unique violation по `telegram_id` роняет обработку первого взаимодействия.
- **E8:** `getOrCreateDefault` (`vocabulary-dictionary.repository.ts:59-79`) — select-then-insert без блокировки → дубль дефолтного словаря / необработанный 23505. Плюс `updateAllTranslations` (`vocabulary.repository.ts:346-383`) = delete+insert — уничтожает SRS-прогресс при регенерации карточки.
- **E9:** rate-limit check-then-log (`translation-request.repository.ts:14-74`) не атомарен: параллельные запросы одного пользователя проходят лимит вдвоём; `logTranslationRequest` делает 3 запроса без транзакции. Дедуп словаря регистрозависим («Hello» ≠ «hello», при том что lookup нормализует NFC+lower).

## Затронутые файлы

- `apps/bot/src/middlewares/auth.ts:22-29`.
- `packages/adapters/db/src/repositories/vocabulary-dictionary.repository.ts:59-79`.
- `packages/adapters/db/src/repositories/vocabulary.repository.ts:346-383`.
- `packages/adapters/db/src/repositories/translation-request.repository.ts:14-74`.

## Решение

1. **E4:** идемпотентный get-or-create: `insert … onConflictDoNothing().returning()` + повторный select.
2. **E8:** `getOrCreateDefault` через `onConflictDoNothing` по `(userId, name)` + повторный select; частичный уникальный индекс `(user_id) WHERE is_default`. `updateAllTranslations` — upsert по `vt_entry_lang_idx` с **сохранением** SRS-полей вместо delete+insert.
3. **E9:** атомарный rate-limit (счётчик/условная вставка) либо принять текущую погрешность для бесплатных лимитов, но зафиксировать риск для платных планов; `logTranslationRequest` обернуть в транзакцию; нормализовать `original` (или уникальный индекс по `lower(original)`) — согласовать с [T04](T04-vocab-unique-index-soft-delete.md) и [T17](T17-word-context-indexes.md).

## Критерии приёмки

- [ ] Параллельные первые апдейты нового пользователя не роняют обработку (один пользователь создаётся).
- [ ] Нет дублей дефолтного словаря при гонке.
- [ ] Регенерация карточки не сбрасывает SRS-историю.
- [ ] Дедуп словаря нечувствителен к регистру (консистентно с lookup).

## Тесты (spec-first)

- Concurrency-тест: N параллельных `getOrCreate` пользователя/словаря → одна запись.
- Тест сохранения SRS при `updateAllTranslations`.
- Тест регистронезависимого дедупа.

## Примечания

Схема БД → drizzle-kit. Нормализация `original`/`word` — сквозная с [T04](T04-vocab-unique-index-soft-delete.md)/[T17](T17-word-context-indexes.md): один подход на всё.
