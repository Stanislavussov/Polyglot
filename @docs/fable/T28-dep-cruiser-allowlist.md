# T28 — Allowlist-правила dependency-cruiser

- **Приоритет:** P2 (Medium)
- **Фаза:** 3 — Архитектурные инвестиции
- **Оценка:** ~1.5 дня
- **Зависит от:** [T22](T22-refactor-translate-helper-di.md), [T24](T24-multichannel-identities.md) (структура модулей должна устаканиться)
- **Блокирует:** —
- **Связано:** —
- **Находки:** A14

## Проблема

`.dependency-cruiser.cjs:161-291` — каждое internal-правило перечисляет соседей явно (enumerated-денайлисты). Модули `srs`, `mentor`, `settings`, `rate-limit`, `dictionary-pipeline`, `video-vocabulary` не упомянуты ни в одном правиле → могут импортировать что угодно, и их никто не контролирует. Плюс `.dependency-cruiser.cjs:118-129` — правило «scenes не импортируют адаптеры» понижено до `info` при 10+ фактических нарушениях в `apps/bot/src/scenes/`.

## Затронутые файлы

- `.dependency-cruiser.cjs:118-129,161-291`.

## Решение

1. Перейти с denylist на **allowlist**: «модуль X может импортировать только shared|i18n|…», чтобы новый модуль по умолчанию был ограничен, а не свободен.
2. Поднять правило «scenes не импортируют адаптеры» до `error` — после того, как [T22](T22-refactor-translate-helper-di.md) переведёт импорты на `ctx.services` (иначе правило сразу красное). Назначить срок/этап.
3. Покрыть неучтённые модули (`srs`, `mentor`, `settings`, `rate-limit`, `dictionary-pipeline`, `video-vocabulary`).

## Критерии приёмки

- [ ] `pnpm lint:deps` использует allowlist; новый модуль без явного разрешения ограничен.
- [ ] Правило scenes→adapters = `error` и проходит (после [T22](T22-refactor-translate-helper-di.md)).
- [ ] Все текущие core-модули покрыты правилами.

## Тесты (spec-first)

- `pnpm lint:deps` зелёный на текущем коде.
- Негативная проверка: искусственный запрещённый импорт ловится правилом.

## Примечания

Делать **после** рефакторов [T22](T22-refactor-translate-helper-di.md)/[T24](T24-multichannel-identities.md) — иначе правила придётся переписывать под старую структуру. Закрепляет достигнутые границы, чтобы они не размылись.
