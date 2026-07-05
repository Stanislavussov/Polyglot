# T16 — Единый метеринг кредитов для всех AI-вызовов

- **Приоритет:** P1 (High — экономический DoS на ключе владельца)
- **Фаза:** 2 — Устойчивость и наблюдаемость
- **Оценка:** ~3 дня
- **Зависит от:** —
- **Блокирует:** —
- **Связано:** [T11](T11-ai-model-guards.md); совпадает с планом «unified queue» из памяти проекта
- **Находки:** S1, S5

## Проблема

Кредитная система (`ensureTranslationQuota`) применяется **только** в translate-flow (`translate-mode.helper.ts:671,1549`). Вне квоты:

- **Mentor** (`scenes/helpers/mentor-mode.helper.ts:34-105`) — `generateChat` на каждое сообщение без проверки кредитов. Free-пользователь гонит mentor-чат бесконечно (тормоз только `sequentialize`), сжигая деньги на OpenRouter-ключе.
- **Dictionary translate** (`dictionary.helper.ts:478-590`), **video vocabulary** (`video-vocabulary.helper.ts` — длинные промпты из YouTube-транскриптов), **grammar/etymology** (`translate-mode.helper.ts:1167,1248,1377` — гейт по плану есть, метеринга нет; результат кэшируется в entry, что частично смягчает).

Это же усиливает риск prompt-injection-jailbreak на вашем ключе (свободный текст mentor-ответа).

## Затронутые файлы

- `apps/bot/src/scenes/helpers/mentor-mode.helper.ts:34-105`.
- `apps/bot/src/scenes/helpers/dictionary.helper.ts:478-590`.
- `apps/bot/src/scenes/helpers/video-vocabulary.helper.ts`.
- `apps/bot/src/scenes/helpers/translate-mode.helper.ts:1167,1248,1377`.
- `packages/core/src/modules/rate-limit/` — единая точка списания.

## Решение

1. Единая точка списания кредитов для **всех** платных AI-вызовов (translate, mentor, dictionary-translate, video, grammar/etymology), а не только translate-flow.
2. Разные веса стоимости по типу вызова (mentor-сообщение, извлечение из видео — дороже).
3. Понятный отказ при исчерпании квоты в каждом флоу.
4. Согласовать с рефактором квоты как части «unified queue» (память проекта про word selection/unified queue).

## Критерии приёмки

- [ ] Mentor-сообщения списывают кредиты; при исчерпании — отказ, а не бесплатный вызов.
- [ ] Dictionary-translate и video-extraction метерятся.
- [ ] Единая функция списания используется всеми флоу (нет параллельных реализаций).

## Тесты (spec-first)

- Behavior-тест: free-пользователь с исчерпанной квотой не может вызвать mentor/dictionary-translate.
- Тест весов: разные типы вызова списывают корректную стоимость.

## Примечания

Требует рабочего mentor-флоу — сначала [T01](T01-mentor-session-validator.md). Guard моделей [T11](T11-ai-model-guards.md) закрывает смежный вектор. Prompt-injection hardening (S6) — в [T30](T30-longtail-cleanup.md).
