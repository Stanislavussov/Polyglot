# T23 — Конвейер шагов в `translate()`

- **Приоритет:** P2 (Medium)
- **Фаза:** 3 — Архитектурные инвестиции
- **Оценка:** ~3 дня
- **Зависит от:** [T22](T22-refactor-translate-helper-di.md)
- **Блокирует:** —
- **Связано:** [T21](T21-single-source-of-truth.md)
- **Находки:** A12, A13

## Проблема

- **A12:** `packages/core/src/modules/translation/translation.service.ts:85-436` — `translate()` это оркестратор ~350 строк (preflight, коррекция опечаток, генерация, валидация, repair, судья, risk-роутинг в одном теле); вход `TranslateInput` оброс булевыми флагами задач (`dictionaryHit`, `skipInputCorrection`, `assessSourceExistence`). Каждая новая задача правит это же место — признак назревающего god-object.
- **A13:** `translate()` возвращает локализованные UI-строки кларификации через `t()` (`translation.service.ts:1048-1075`) — смешение domain и presentation; web-канал не переиспользует решение без вёрстки.

## Затронутые файлы

- `packages/core/src/modules/translation/translation.service.ts:85-436,1048-1075`.
- `packages/core/src/modules/translation/types.ts:167,181,192` — флаги входа.

## Решение

1. Оформить как конвейер шагов (preflight → generate → validate/repair → judge) с явным контекстом; новый шаг = новый элемент конвейера (OCP), а не правка тела.
2. Сгруппировать булевы флаги входа в объект политики (`correctionPolicy` и т.п.).
3. Вернуть из core структурированный `reason` + параметры (`word`, `lang`) вместо готовых локализованных строк; рендеринг и `t()` — на стороне канала (бот уже умеет).

## Критерии приёмки

- [ ] `translate()` — тонкий оркестратор поверх явных шагов; добавление шага не требует правки существующих.
- [ ] Core не возвращает локализованные UI-строки — только структурированные reason'ы.
- [ ] Флаги входа сгруппированы в политику.

## Тесты (spec-first)

- Behavior-тесты по каждому шагу конвейера (preflight/typo/judge) изолированно.
- Тест: кларификация приходит структурой, бот рендерит через `t()`.

## Примечания

Делать после распила helper'а [T22](T22-refactor-translate-helper-di.md). Вынос локализации из domain — предпосылка мультиканальности [T24](T24-multichannel-identities.md).
