# T22 — Распил `translate-mode.helper` + DI через `ctx.services`

- **Приоритет:** P1 (High — god-модуль + корень тестовой боли)
- **Фаза:** 3 — Архитектурные инвестиции
- **Оценка:** ~5 дней
- **Зависит от:** [T01](T01-mentor-session-validator.md), [T02](T02-finish-out-of-set-diff.md), [T19](T19-translationmap-eviction.md) (изменения того же файла/сессии должны лечь раньше)
- **Блокирует:** [T23](T23-translate-pipeline.md), [T28](T28-dep-cruiser-allowlist.md)
- **Связано:** —
- **Находки:** B2, B7

## Проблема

- **B2:** `apps/bot/src/scenes/helpers/translate-mode.helper.ts` — 2010 строк, 15+ экспортируемых хендлеров и **два почти идентичных полных конвейера перевода**: `handleTranslateText` (~689-878) и `handleMistypeConfirmCallback` (~1553-1700) дублируют ~150 строк (квота, шаблон, `withTimeout`, ветка clarification, рендер карточки, логирование таймингов). Любое изменение конвейера вносится дважды.
- **B7:** DI-контейнер обходится прямыми импортами `@polyglot/adapter-db` в хелперах/middleware (`translate-mode.helper.ts:7-12`, `mode-router.ts:9`, `auth.ts:1`, `notification.wiring.ts`). Следствие — 20 тестовых файлов делают `vi.mock("@polyglot/adapter-db")` с рукописной фабрикой всех экспортов; каждый новый экспорт адаптера ломает все моки, тесты гоняются против dist (известная боль проекта).

## Затронутые файлы

- `apps/bot/src/scenes/helpers/translate-mode.helper.ts` (весь).
- `apps/bot/src/middlewares/mode-router.ts:9`, `apps/bot/src/middlewares/auth.ts:1`.
- `apps/bot/src/notifications/notification.wiring.ts`.
- `apps/bot/src/container.ts` — `ctx.services`.

## Решение

1. Извлечь `runTranslationPipeline(ctx, input, opts)` — единый конвейер, оба хендлера вызывают его (устранить ~150 строк дубля).
2. Разрезать файл на `translate-flow`, `clarification`, `card-actions`, `out-of-set`.
3. Перевести прямые импорты `adapter-db` в зависимости через `ctx.services` (репозитории в контейнере) — тогда тесты подменяют `ctx.services`, а не module-mock на dist. Это снимает боль `vi.mock` и рассинхрон моков.

## Критерии приёмки

- [ ] Один конвейер перевода; дубль устранён.
- [ ] Хелперы/middleware не импортируют `adapter-db` напрямую — только через `ctx.services`.
- [ ] Тесты сцен не используют `vi.mock("@polyglot/adapter-db")` с рукописной фабрикой; не зависят от dist.

## Тесты (spec-first)

- Behavior-тесты обоих флоу (обычный перевод и mistype-confirm) через извлечённый pipeline — поведение неизменно.
- Тесты сцен через подмену `ctx.services` (без module-mock).

## Примечания

Крупный рефактор — вести маленькими red-green слайсами (CLAUDE.md Hard Rule #5). Ложится **после** [T01](T01-mentor-session-validator.md)/[T02](T02-finish-out-of-set-diff.md)/[T19](T19-translationmap-eviction.md), чтобы не конфликтовать. Разблокирует конвейер translate [T23](T23-translate-pipeline.md) и границы dep-cruiser [T28](T28-dep-cruiser-allowlist.md).
