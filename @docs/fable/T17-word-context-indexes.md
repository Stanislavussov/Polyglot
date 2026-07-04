# T17 — Индексы горячего пути `word_context`

- **Приоритет:** P1 (High — seq scan на каждый перевод)
- **Фаза:** 2 — Устойчивость и наблюдаемость
- **Оценка:** ~1 день
- **Зависит от:** —
- **Блокирует:** —
- **Связано:** [T25](T25-telemetry-retention-timezone.md) (общая тема масштабирования данных)
- **Находки:** E2

## Проблема

`packages/adapters/db/src/repositories/word-context.repository.ts:35,52` — `ilike(word, …)` (btree-индекс не работает с ILIKE) плюс `arrayContains(forms, [word])` (нужен GIN, его нет — в `schema.ts:61-64` только btree). Это preflight **каждого** перевода (`context-lookup.ts`) и языковой sweep (`word-language-sweep.ts`). На kaikki-дампах (сотни тысяч/миллионы строк) — полный скан таблицы на каждое сообщение.

## Затронутые файлы

- `packages/adapters/db/src/repositories/word-context.repository.ts:35,52`.
- `packages/adapters/db/src/schema.ts:61-64`.
- Новая миграция.

## Решение

1. Хранить `word` нормализованным (`lower`/NFC) и искать через `=` по функциональному индексу `lower(word)` вместо `ILIKE`. (Согласовать нормализацию с E9/дедупом словаря — [T04](T04-vocab-unique-index-soft-delete.md)/[T18](T18-check-then-insert-races.md).)
2. `GIN`-индекс на массив `forms` для `arrayContains`.
3. Проверить план запроса (`EXPLAIN ANALYZE`) до/после на репрезентативном объёме.

## Критерии приёмки

- [ ] `EXPLAIN` по preflight-запросу использует индекс, не seq scan.
- [ ] Латентность lookup на большом дампе падает на порядок.
- [ ] Функциональная корректность lookup сохранена (нормализация консистентна с записью).

## Тесты (spec-first)

- Integration-тест: lookup находит слово по нормализованной форме и по `forms`.
- (Опц.) бенч-проверка плана запроса на seed-объёме.

## Примечания

Схема БД → drizzle-kit workflow. Нормализация `word` — сквозная тема с дедупом словаря; выровнять один подход к нормализации во всех местах.
