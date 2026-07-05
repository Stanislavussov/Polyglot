# T25 — Retention телеметрии + timezone-aware timestamps

- **Приоритет:** P2 (Medium — узкое место через 2–3 шага роста)
- **Фаза:** 3 — Архитектурные инвестиции
- **Оценка:** ~2 дня
- **Зависит от:** —
- **Блокирует:** —
- **Связано:** [T17](T17-word-context-indexes.md), [T10](T10-pino-redact-pii.md)
- **Находки:** E5, E6

## Проблема

- **E5:** нет retention/партиционирования нигде. Растут навсегда: `dictionary_lookup_logs` (строка на каждый lookup!), `translation_requests` + junction, `translation_request_timings`, `ai_request_latencies`, `language_detection_events`, `notification_history`, `word_review_log`, `bot_sessions`. Rate-limit агрегирует `sum(credit_cost)` по вечной `translation_requests`. Через 2–3 шага роста — главное узкое место.
- **E6:** все timestamps без time zone (0 вхождений `withTimezone`) + сравнения `new Date()` в коде (`notification.repository.ts:100`, rate-limit window) — корректны только пока Postgres и Node в UTC. Смена TZ контейнера/хоста сдвинет SRS-даты, окна уведомлений, rate-limit.

## Затронутые файлы

- `packages/adapters/db/src/schema.ts` — типы колонок.
- Репозитории телеметрии в `packages/adapters/db/src/repositories/`.
- Новые миграции + механизм чистки.

## Решение

1. **Retention:** периодическая чистка (например 90 дней) для чистой телеметрии; для `dictionary_lookup_logs`/`timings` — партиционирование по месяцу. Для rate-limit — компактный счётчик в отдельной таблице вместо агрегации по вечной.
2. **Timezone:** `timestamp(..., { withTimezone: true })` для новых колонок; миграция существующих; зафиксировать UTC-инвариант или перейти на tz-aware сравнения.
3. PII-тексты (`translation_requests.original`, `dictionary_lookup_logs.lookup_input`, `notification_context`) — включить в retention (согласовать с [T10](T10-pino-redact-pii.md)).

## Критерии приёмки

- [ ] Лог-таблицы имеют ограниченный горизонт хранения (чистка/партиции работают).
- [ ] Rate-limit не агрегирует по неограниченно растущей таблице.
- [ ] Новые timestamp-колонки tz-aware; поведение не зависит от TZ контейнера.

## Тесты (spec-first)

- Тест чистки: записи старше горизонта удаляются/архивируются, свежие остаются.
- Тест tz: расчёт SRS-даты/окна уведомления стабилен при смене TZ процесса.

## Примечания

Схема БД → drizzle-kit. Заложить в ближайший квартал до серьёзного роста аудитории.
