# T21 — Ликвидация двоевластия код/БД

- **Приоритет:** P1 (High — корневая системная тема, родитель инцидента 429)
- **Фаза:** 3 — Архитектурные инвестиции
- **Оценка:** ~5 дней (эпик, можно дробить по находкам)
- **Зависит от:** [T11](T11-ai-model-guards.md) (тактический guard — промежуточная защита)
- **Блокирует:** [T24](T24-multichannel-identities.md)
- **Связано:** [T03](T03-container-cast-estimatecost.md)
- **Находки:** A2, A3, A4, A7, A8

## Проблема

Ключевые данные существуют одновременно в коде и в БД — какой источник действует, зависит от call-site:

- **A7 — тарифы:** `PLAN_LIMITS` (`rate-limit/index.ts:18-23`) vs таблица `rate_limit_plans`; обе ветки (`evaluateRateLimit`/`evaluatePlanRateLimit`) экспортированы.
- **A8 — модели/цены:** `MODEL_REGISTRY` с ценами (`adapters/ai/src/models.ts:9-74`) vs таблица `ai_models`; новая модель из админки получает `DEFAULT_COST_PER_1K` — учёт стоимости молча врёт.
- **A4 — настройки генерации:** `AIGenerationDefaults` из админки (`settings.port.ts:14-25`) игнорируются адаптером — `temperature/maxTokens/maxRetries` захардкожены (`adapters/ai/src/index.ts:23,51-53`); подключён только таймаут. Мёртвый контракт.
- **A2 — judge-модель:** захардкожена в core (`translation.service.ts:934-944`: `openai/`, `google/gemini-2.5-flash`) — противоречит политике «модель из БД».
- **A3 — языки:** два реестра метаданных (`i18n/language-registry.ts` и `adapter-db/language-cache.ts`) с дублированной нормализацией; бот использует оба.

## Затронутые файлы

- `packages/core/src/modules/rate-limit/index.ts:18-23,44,54`.
- `packages/adapters/ai/src/models.ts:9-74`, `packages/adapters/ai/src/index.ts:23,51-53`.
- `packages/core/src/modules/translation/translation.service.ts:60,934-944`.
- `packages/core/src/modules/i18n/language-registry.ts`, `packages/adapters/db/src/language-cache.ts`.

## Решение

1. **Тарифы:** удалить `PLAN_LIMITS` и `evaluateRateLimit`; оставить чистую `evaluatePlanRateLimit(planLimit, …)`, лимиты — только из `SettingsPort`.
2. **Модели/цены:** источник — БД (`ai_models`, админ-CRUD уже есть); адаптеру инжектировать провайдер цен тем же паттерном, что и timeout-provider.
3. **Настройки генерации:** передать в адаптер провайдер всех `AIGenerationDefaults` (не только таймаут), убрать литералы.
4. **Judge-модель:** брать из `modelRouting.judgeModel`; правило «судья ≠ семейство генератора» оставить в core, конкретные пары — в БД/`SettingsPort`.
5. **Языки:** один источник — core `language-registry` (данные из БД при старте); `LanguageCachePort` свести к загрузчику, делегирующему в реестр.

## Критерии приёмки

- [ ] Изменение тарифа/цены модели/temperature в админке влияет на поведение без релиза.
- [ ] Нет двух экспортированных веток rate-limit; нет `MODEL_REGISTRY`-цен в коде.
- [ ] Judge-модель конфигурируема; один языковой реестр.

## Тесты (spec-first)

- Тесты: изменение настройки в источнике-БД отражается в поведении сервиса (rate-limit, стоимость, judge-выбор).
- Регрессия: удаление дублирующих экспортов не ломает вызовы.

## Примечания

Эпик — дробить по находкам (A7 и A8 — самые быстрые и ценные). До завершения действует тактический guard [T11](T11-ai-model-guards.md). Чистый источник настроек — предпосылка мультиканальности [T24](T24-multichannel-identities.md).
