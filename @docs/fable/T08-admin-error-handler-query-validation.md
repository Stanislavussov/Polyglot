# T08 — Глобальный error-handler + zod на query-параметрах

- **Приоритет:** P1 (High)
- **Фаза:** 1 — Безопасность
- **Оценка:** ~1 день
- **Зависит от:** —
- **Блокирует:** [T27](T27-admin-service-layer-contracts.md)
- **Связано:** [T07](T07-admin-rbac-auth-hook.md)
- **Находки:** S9, D5

## Проблема

Маршруты используют `schema.parse()` (`auth.ts:13`, `ai-models.ts:210` и др.), но `setErrorHandler` в приложении нет. Fastify по умолчанию вернёт **500 с телом ZodError** (структура схемы, пути полей) наружу. Query-параметры не валидируются zod: `users.ts:27-39` — `request.query as {...}`, `parseInt` → `NaN` уходит в запрос (500), а `?limit=1000000` выгружает всю таблицу `users` с PII (`telegramId`, `username`) одним запросом. `total` в `users.ts:68` считается без учёта `search` (пагинация при поиске врёт). `days` в `stats.ts:56-70` не клампится (в отличие от аккуратного `dictionary-lookups`).

## Затронутые файлы

- `apps/admin-api/src/index.ts` — регистрация `setErrorHandler`.
- `apps/admin-api/src/routes/users.ts:27-39,68`.
- `apps/admin-api/src/routes/stats.ts:26-31,56-70`.
- Прочие маршруты с query-параметрами.

## Решение

1. Глобальный `setErrorHandler`: `ZodError → 400` с безопасным телом; 5xx — без утечки внутренних сообщений.
2. Валидировать query через zod во всех маршрутах: `z.coerce.number().int().min(1).max(N)` для `limit`/`page`/`days` (образец — `reported-issues.ts:8-13`).
3. Считать `total` с тем же `where`, что и выборка (учитывать `search`); `count(*)::int`.
4. Заодно поправить метрику `activeToday` (`stats.ts:26-31`): считать по `user_language_settings.last_interaction_at`, а не по `users.createdAt` (D5).

## Критерии приёмки

- [ ] Невалидное тело/query → 400 с чистым телом, без внутренностей ZodError и без 500.
- [ ] `?limit` ограничен сверху; выгрузить всю таблицу users нельзя.
- [ ] Пагинация с `search` показывает корректный `total`.
- [ ] `activeToday` отражает активность, а не регистрации.

## Тесты (spec-first)

- Тест: `?limit=abc` → 400 (не 500); `?limit=100000` → клампится.
- Тест: поиск с пагинацией даёт согласованные `total`/страницы.
- Тест error-handler: брошенный ZodError → 400 с безопасным телом.

## Примечания

Разнобой валидации query-параметров — прямое следствие copy-paste CRUD (D4); системно решается фабрикой/контрактами в [T27](T27-admin-service-layer-contracts.md).
