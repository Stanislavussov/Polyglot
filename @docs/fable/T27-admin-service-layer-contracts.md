# T27 — Сервисный слой admin-api + пакет контрактов

- **Приоритет:** P2 (Medium)
- **Фаза:** 3 — Архитектурные инвестиции
- **Оценка:** ~3 дня
- **Зависит от:** [T07](T07-admin-rbac-auth-hook.md), [T08](T08-admin-error-handler-query-validation.md)
- **Блокирует:** —
- **Связано:** [T21](T21-single-source-of-truth.md)
- **Находки:** D3, D4

## Проблема

- **D3:** admin-api обходит доменный слой — контроллеры ходят прямо в репозитории, `users.ts:41-72` и `stats.ts:20-50` пишут сырые Drizzle-запросы в хендлерах; `@polyglot/core` импортируется только как типы, дефолты настроек продублированы (`ai-defaults.ts:15-21`/`dictionary.ts:12-16` vs fallback'ы в `core/settings.service.ts`). Бизнес-правила размазаны между route-хендлерами и репозиториями.
- **D4:** zod-схемы в двух копиях (`apps/admin/src/lib/validation.ts` vs route-файлы) — дрейф неизбежен; новый CRUD = ~6 точек copy-paste без переиспользуемой фабрики.

## Затронутые файлы

- `apps/admin-api/src/routes/users.ts:41-72`, `apps/admin-api/src/routes/stats.ts:20-50`, `apps/admin-api/src/routes/ai-defaults.ts:15-21`.
- `apps/admin/src/lib/validation.ts`.
- Новый пакет `@polyglot/admin-contracts` (или аналог).

## Решение

1. Тонкий сервисный слой в admin-api (или переиспользование core-сервисов) для инвариантов (валидная default-модель, инварианты планов); сырой Drizzle — только в репозиториях.
2. Общий пакет контрактов (zod-схемы admin ↔ admin-api в одном месте) — убрать дрейф.
3. Generic-хелпер `registerCrudRoutes(app, repo, schemas)` + общий composable для Manager-компонентов, чтобы новая сущность не была copy-paste со всеми багами предыдущей (разнобой валидации query из [T08](T08-admin-error-handler-query-validation.md)).
4. Устранить дублирование дефолтов настроек (связать с [T21](T21-single-source-of-truth.md)).

## Критерии приёмки

- [ ] Сырой Drizzle в хендлерах отсутствует; инварианты — в сервисном слое.
- [ ] Контракты admin/admin-api — единый источник, дублей нет.
- [ ] Новый CRUD добавляется через фабрику/хелпер, не полным copy-paste.

## Тесты (spec-first)

- Тест инварианта в сервисном слое (например запрет удаления default-модели — переиспользует [T11](T11-ai-model-guards.md)).
- Тест, что фабрика CRUD генерирует консистентную валидацию query.

## Примечания

Ложится после консолидации auth-хука [T07](T07-admin-rbac-auth-hook.md) и error-handler'а [T08](T08-admin-error-handler-query-validation.md). Пакет контрактов должен уважать правило «без барьельных файлов» из CLAUDE.md (импорт из источника).
