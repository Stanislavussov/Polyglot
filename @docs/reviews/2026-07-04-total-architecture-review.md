# Тотальное архитектурное ревью Polyglot — 2026-07-04

Полный аудит по шести направлениям: ядро (GRASP/SOLID, границы модулей), приложение бота, admin/admin-api/landing, слой БД, инфраструктура/деплой, сквозная безопасность. Проведён шестью параллельными независимыми аудиторами, сведён в этот документ.

## Вердикт (TL;DR)

Проект заметно зрелее среднего для своей стадии: гексагональный замысел с портами в core, композиционный корень, dependency-cruiser, Postgres-сессии с `sequentialize`, репозиторный паттерн почти без утечек, non-root multi-stage Docker, все порты за `127.0.0.1`, образцовая гигиена секретов (в git и его истории реальных токенов нет), AI-ответы валидируются zod-схемами, недавние AI-таймауты сделаны образцово.

**Пять критических находок** (детали ниже): валидатор сессии убивает режим mentor; уникальный индекс словаря конфликтует с soft-delete; композиционный корень собран через `as unknown as` (типовой контроль портов выключен и уже прячет реальный баг); healthz — чистый liveness и ни одного алерта (инцидент 429 повторится незамеченным); деплой без health-гейта и отката, миграции применяются под старым кодом.

**Семь системных тем**, порождающих большинство находок:

1. **Двоевластие источников правды (код vs БД)** — тарифы, реестр моделей с ценами, языковые метаданные (два реестра), настройки генерации из админки игнорируются адаптером, judge-модель захардкожена в core. Это прямой родственник инцидента с зависанием на `:free`-модели.
2. **AI-вызовы вне кредитной системы** — mentor, dictionary-translate, video-vocabulary, grammar/etymology не метерятся: экономический DoS на ключе владельца.
3. **Наблюдаемость без реакции** — богатые метрики, ноль алертов, liveness-only healthcheck.
4. **Check-then-insert без опоры на констрейнты** — создание пользователя, дефолтный словарь, дедуп словаря + soft-delete (уже даёт пользовательский баг).
5. **God-модули и copy-paste** — `translate-mode.helper.ts` (2010 строк, два дублированных конвейера), `translate()` в core (~350 строк, поглощает каждую фичу), тройное дублирование каркаса в AI-адаптере, 11 копий auth-хука и copy-paste CRUD в admin-api.
6. **Telegram-идентичность вшита в ядро** — telegramId в core-портах, BOT_TOKEN обязателен в infra для любого приложения, «Telegram bot» в core-промптах: новый канал = правка стабильных слоёв.
7. **Отсутствие retention** — 8+ лог-таблиц растут на каждое сообщение навсегда; горячие запросы к `word_context` (ILIKE + arrayContains) без индексов.

---

## Критические находки

### C1. Валидатор сессии не знает режим `mentor` — сессия уничтожается на каждом апдейте
`apps/bot/src/session-storage.ts:16` — `VALID_MODES = new Set(["idle", "translate"])`, тогда как `types.ts:20` включает `"mentor"`. После `/mentor` каждая реплика помечает сессию как «corrupt» и удаляет её: история ментора стирается (ментор с амнезией), заодно теряются `translationMap` и pending-состояния. Роутинг выживает только благодаря регидрации режима из БД (`auth.ts:36-41`).
**Фикс:** одна строка + тест на каждый член union `UserMode`; заменить деструктивное удаление на миграцию по `BOT_SESSION_VERSION`.

### C2. Уникальный индекс дедупликации конфликтует с soft-delete — сохранение слова падает с 23505
`packages/adapters/db/src/schema.ts:178` (`ve_user_original_sourcelang_idx` без `WHERE is_active`), `vocabulary.repository.ts:132-160` (проверка дубликата фильтрует `isActive = true`), `notification.callbacks.ts:119` (soft-delete). Удалил слово → сохранил снова → необработанный unique violation.
**Фикс:** частичный уникальный индекс (`WHERE is_active`) + реактивация записи вместо insert, либо `onConflictDoUpdate`.

### C3. Композиционный корень собран через двойной cast — контроль контрактов портов отключён
`apps/bot/src/container.ts:101` — `} as unknown as ServiceContainer`. Уже прячет реальное расхождение: `ports/ai.port.ts:40` требует `estimateCost(inputTokens, outputTokens, modelId)`, а реализация `adapters/ai/src/models.ts:98` — `estimateCost(tokens, model)`: `outputTokens` передаётся как имя модели → молча считается дефолтная цена. Любой будущий дрейф порт/адаптер пройдёт незамеченным.
**Фикс:** `const container: ServiceContainer = {...}` без cast, выровнять сигнатуру (в адаптере уже есть подходящий `calculateCost`).

### C4. `/healthz` — чистый liveness; алертов нет вообще
`apps/bot/src/metrics.ts:126-128` всегда возвращает ok, не проверяя живость long-polling и проходимость AI-запросов; в Grafana provisioning нет ни alert rules, ни contact points, Alertmanager отсутствует. Известный инцидент «бот молча завис на 429» не был бы замечен и сегодня. Метрики для алертов уже есть — не хватает только правил.
**Фикс:** readiness (последний успешный getUpdates < N сек, ping БД) + 3–4 provisioned-алерта (`rate(bot_translations_total{status="error"})`, тишина `bot_telegram_messages_total` 10 мин, `up==0`) + contact point (Telegram/email).

### C5. Деплой без health-гейта и отката; миграции под работающим старым кодом
`.github/workflows/deploy.yml:166-178` — порядок `migrate` → seed → `up -d`; между миграцией и переключением старый бот работает против новой схемы; после `up -d` нет проверки healthy (crash-loop = зелёный workflow); `docker image prune -af` удаляет образы для отката.
**Фикс:** ожидание `.State.Health.Status` с fail workflow; хранить тег предыдущего релиза + документированный rollback; политика expand/contract для миграций.

---

## Безопасность

Чисто: секреты (git + история), SQLi (везде параметризованный Drizzle), XSS в боте (`esc()` повсеместно), парсинг AI-ответов (только `generateObject` + zod, без сырого `JSON.parse`), подделка callback data (резолв через собственную сессию + проверка владельца), порты наружу (всё за nginx/TLS), пароли админов (bcrypt, без дефолтных кредов, обязательный `JWT_SECRET`).

| # | Sev | Находка | Где |
|---|-----|---------|-----|
| S1 | HIGH | Mentor — неметерённые платные AI-вызовы (cost DoS): нет проверки квоты, free-юзер жжёт OpenRouter-ключ неограниченно | `apps/bot/src/scenes/helpers/mentor-mode.helper.ts:34-105` |
| S2 | HIGH | `/api/auth/login` без rate limiting / lockout, публично в интернете; JWT 24 ч без отзыва | `apps/admin-api/src/routes/auth.ts:12-30`, `index.ts:33-60` |
| S3 | HIGH | Внутренние отчёты публичны без auth: `database-schema.html`, `test-catalog.json` (~1951 сценариев), architecture-overview — полная карта системы для атакующего | `apps/admin/public/reports/`, nginx `site.yml:247-262` |
| S4 | HIGH | Деактивация админа не отзывает доступ: `isActive` проверяется только при логине; нет ревокации/tokenVersion | `routes/auth.ts:16,32-39` |
| S5 | MED | Прочие AI-фичи вне квоты: dictionary-translate, video-vocabulary, grammar/etymology (гейт по плану есть, метеринга нет) | `dictionary.helper.ts:478-590`, `video-vocabulary.helper.ts`, `translate-mode.helper.ts:1167,1248,1377` |
| S6 | MED | Prompt injection: ввод интерполируется в промпты без нейтрализации; риск jailbreak на вашем ключе (особенно mentor — свободный текст). Смягчено: zod-схемы, показ только автору, esc() при рендере | `packages/core/src/modules/translation/prompt.builder.ts:55-56,116-119,291-292,404` |
| S7 | MED | Pino без `redact`: тексты сообщений, telegramId/username уходят в логи → Betterstack/Loki (PII третьей стороне) | `packages/core/src/logger.ts:16`, `mode-router.ts:70,112`, `auth.ts:29` |
| S8 | MED | RBAC отсутствует: роль в JWT нигде не проверяется; любой активный админ может удалять AI-модели/тарифы. Декоратор `authenticate` — мёртвый код, хук скопипащен в 11 файлов | `plugins/auth.ts:19-30`, все route-файлы |
| S9 | MED | ZodError → 500 с внутренностями валидатора (нет `setErrorHandler`); query-параметры без zod (`parseInt` → NaN → 500, `limit` не клампится → выгрузка всей таблицы users с PII) | `routes/auth.ts:13`, `routes/users.ts:27-39,68` |
| S10 | MED | Bootstrap-фаза nginx: логин админки/Grafana по чистому HTTP до выпуска сертификата | `deploy/ansible/site.yml:226-242,306-340` |
| S11 | LOW | JWT в `localStorage` (XSS = кража на 24 ч без отзыва); SSR-страницы админки не защищены на сервере (только клиентский редирект) | `apps/admin/src/lib/api.ts:13-32` |
| S12 | LOW | Неэкранированные `%`/`_` в ILIKE; флуд новыми аккаунтами = бесплатные DB-записи; dev-JWT_SECRET в override-компоузе (в прод не попадает) | `vocabulary.repository.ts:69,235`, `middlewares/auth.ts:22-48`, `docker-compose.override.yml:21` |

---

## Архитектура ядра (GRASP/SOLID)

Сильные стороны: порты в `packages/core/src/ports/`, leaf-модули, слоистые правила dependency-cruiser, инъекция данных вместо обращения к БД из core, i18n-локали покрыты тестами на паритет.

| # | Sev | Находка | Где |
|---|-----|---------|-----|
| A1 | HIGH | Telegram-идентичность в core-портах (`telegramId`, `findByTelegramId`, `SendFn(telegramId)`): новый канал = миграция схемы + правка всех портов. Нарушение Protected Variations | `ports/user.repository.ts:9,20,49`, `ports/notification.repository.ts:8`, `adapters/notifications/src/types.ts:12` |
| A2 | HIGH | Захардкоженные ID моделей в core: `selectJudgeModel` знает `openai/`, `google/gemini-2.5-flash` — противоречит политике «модель управляется через БД» | `translation.service.ts:934-944` |
| A3 | HIGH | Два параллельных реестра языковых метаданных с дублированной логикой нормализации; бот использует оба | `core/.../i18n/language-registry.ts` и `adapter-db/src/language-cache.ts` |
| A4 | HIGH | `AIGenerationDefaults` из админки игнорируются адаптером (кроме таймаута): temperature/maxTokens/maxRetries захардкожены — «мёртвый» контракт | `ports/settings.port.ts:14-25` vs `adapters/ai/src/index.ts:23,51-53` |
| A5 | HIGH | Фантомная зависимость: core использует zod в рантайме в 7 файлах, не объявляя в deps (работает через walk-up на корневой package.json) | `packages/core/package.json` |
| A6 | HIGH | Новый язык = shotgun surgery по ≥7 точкам в 3 пакетах + БД: `SupportedLang` union, ручные require локалей, `SUPPORTED_LANGS`, `LANGUAGE_TRAITS`, `COMMON_TRANSLATION_LANGS`, `SCRIPT_TO_LANGS`, строка в `languages` | `i18n/types.ts:322`, `i18n.ts:10-56`, `language-traits.ts:24-90`, `translation.service.ts:60`, `detect-language.ts:53-77` |
| A7 | HIGH | Тарифы задублированы: `PLAN_LIMITS` в core vs `rate_limit_plans` в БД; обе ветки (`evaluateRateLimit`/`evaluatePlanRateLimit`) экспортированы — какой источник действует, зависит от call-site | `rate-limit/index.ts:18-23,44,54` |
| A8 | HIGH | `MODEL_REGISTRY` с ценами захардкожен в AI-адаптере, дублирует таблицу `ai_models`; новая модель из админки получает `DEFAULT_COST_PER_1K` — учёт стоимости молча врёт | `adapters/ai/src/models.ts:9-74` |
| A9 | MED | Логика в index.ts вопреки Hard Rule #4 проекта: вся реализация AI-адаптера и rate-limit живут в index-файлах | `adapters/ai/src/index.ts:34-215`, `rate-limit/index.ts` |
| A10 | MED | Тройное дублирование ~60-строчного каркаса timeout→вызов→логирование→нормализация в AI-адаптере | `adapters/ai/src/index.ts:34-92,102-151,165-215` |
| A11 | MED | `GenerateObjectFn` объявлен трижды с разными сигнатурами; двойной DI-механизм (AIPort vs generateObjectFn-параметры); экспортный конфликт уже дал костыль TS2308 | `translation.service.ts:69`, `idiom-analysis/types.ts:53`, `extraction.service.ts:13`, `core/src/index.ts:79-89` |
| A12 | MED | `translate()` — оркестратор ~350 строк (preflight, typo, генерация, repair, судья, risk-роутинг), вход оброс булевыми флагами; каждая фича правит это место | `translation.service.ts:85-436` |
| A13 | MED | Core возвращает локализованные UI-строки (кларификация через `t()`): смешение domain и presentation | `translation.service.ts:1048-1075` |
| A14 | MED | dependency-cruiser: enumerated-денайлисты устарели, модули srs/mentor/settings/rate-limit/video-vocabulary не ограничены; «scenes не импортируют адаптеры» понижено до info при 10+ нарушениях | `.dependency-cruiser.cjs:118-129,161-291` |
| A15 | MED | Промпт+схема «контекстного предложения» живут в notifications-адаптере (в отличие от всего проекта); в промпт подставляются коды языков вместо названий («in ru») | `adapters/notifications/src/notification.service.ts:5-10,116-133` |
| A16 | MED | Все deps `NotificationServiceDeps` опциональны — недособранный контейнер молча не шлёт уведомления (warn в рантайме) | `adapters/notifications/src/types.ts:82-104` |
| A17 | MED | AI-адаптер: модульный синглтон клиента, глобальные сеттеры-локаторы, чтение `process.env` изнутри адаптера | `adapters/ai/src/client.ts:10,18`, `index.ts:10,12` |
| A18 | MED | infra требует `BOT_TOKEN` для любого приложения и делает `process.exit(1)` из библиотеки | `packages/infra/src/config.ts:8,44` |
| A19 | MED | Тип уведомления — закрытый union, продублированный в двух портах + switch в scheduler: новый тип = синхронная правка трёх пакетов | `ports/notification.repository.ts:4`, `ports/settings.port.ts:34` |
| A20 | MED | `I18nParams` не используется: `t()` принимает произвольный Record; `I18nKey` — ручной 315-строчный union без компайл-связки с en.json | `i18n/i18n.ts:72`, `i18n/types.ts:5,334+` |
| A21 | LOW | Два механизма логирования (`logger` синглтон vs `getLogger/setLogger`) — подмена работает не везде; `SubscriptionPlan = string`; порт AI именует zod (`ZodSchema` в интерфейсе); «Telegram bot» в mentor-промпте core; шим-баррель `translation-output.presets.ts` | `core/src/logger.ts`, `ports/ai.port.ts:4`, `mentor/prompt.builder.ts:39` |

---

## Приложение бота

Сильные стороны: тонкие сцены + composition root, Postgres-сессии + `sequentialize` (ключ совпадает с ключом сессии), транспортно-агностичная фабрика (webhook = правка только `index.ts`), образцовые AI-таймауты (`AbortController` покрывает и SDK-ретраи, бюджет из БД).

| # | Sev | Находка | Где |
|---|-----|---------|-----|
| B1 | CRIT | → C1 (валидатор сессии убивает mentor) | `session-storage.ts:16` |
| B2 | HIGH | `translate-mode.helper.ts` — 2010 строк, 15+ хендлеров, два почти идентичных конвейера перевода (`handleTranslateText` ~689-878 и `handleMistypeConfirmCallback` ~1553-1700, ~150 дублированных строк) | `scenes/helpers/translate-mode.helper.ts` |
| B3 | HIGH | `bot.catch` молчит для пользователя (замерший «Translating…» — сценарий инцидента) и сам может упасть: читает `ctx.session` который может отсутствовать; нет различения GrammyError/HttpError | `bot-factory.ts:320-336` |
| B4 | HIGH | Нет обработки Telegram 429 (ни auto-retry, ни throttler) — апдейт теряется при flood-limit; нотификации рассылаются пачками без троттлинга | весь проект, `scheduler.ts` |
| B5 | HIGH | 403 (пользователь заблокировал бота) не распознаётся: `sendWithRetry` ретраит перманентную ошибку, юзер навсегда в рассылке; `disableNotifications` существует, но не вызывается | `notification.wiring.ts:97-113`, `scheduler.ts:219` |
| B6 | HIGH | `translationMap` растёт неограниченно в строке сессии (ни одного delete) — деградация латентности всех апдейтов активного пользователя | `types.ts:45-59`, `translate-mode.helper.ts:844-850` |
| B7 | HIGH | DI-контейнер обходится прямыми импортами adapter-db в хелперах/middleware — корень боли с `vi.mock` на dist (20 тестовых файлов с рукописной фабрикой всех экспортов) | `translate-mode.helper.ts:7-12`, `mode-router.ts:9`, `auth.ts:1`, `notification.wiring.ts` |
| B8 | MED | Двухслойные таймауты рассинхронизированы: `LONG_OP_TIMEOUT_MS=20s` захардкожен, бюджет AI конфигурируем из админки; если бюджет > 20s — внешний guard бросает работу без отмены (деньги потрачены, результат выброшен) | `long-op.ts:11,53-56` |
| B9 | MED | Незакоммиченный diff (out-of-set языки): нелокализованные строки (:325,335,351), конфляция ошибок (любая ошибка БД = «достигнут максимум языков», :348-355), single-slot race `pendingOutOfSet` (тап по старой кнопке добавит один язык, а переведёт слово другого, :331,374); `tr:oos` не добавлен в реестр контрактов. Функционально diff хорош и закрывает известную дыру | `translate-mode.helper.ts` (working tree) |
| B10 | MED | Хардкод-список префиксов конверсаций в `exitActiveConversations`: новая конверсация вне списка молча убивается | `bot-factory.ts:144-153` |
| B11 | MED | 90 ручных callbackQuery-регистраций в фабрике; порядок regex несёт неявные ловушки (`set:learn:lvl:` до `set:learn:` и т.п.) | `bot-factory.ts:233-316` |
| B12 | MED | Graceful shutdown не закрывает metrics-сервер (процесс живёт до SIGKILL) и не ограничен дедлайном | `index.ts:22-42`, `metrics.ts:121-138` |
| B13 | MED | 2–3 запроса `getSettings` на каждое сообщение (42 call-site); `user.settings` в типе контекста декларирован, но не заполняется | `auth.ts:37`, `mode-router.ts:33` |
| B14 | MED | Горизонтальное масштабирование невозможно молча: in-process `sequentialize`, upsert сессии без optimistic locking — lost-update при >1 реплике; нигде не зафиксировано | `bot-factory.ts:191`, `session-storage.ts:42-44` |
| B15 | LOW | Нет идемпотентности по `update_id` (передоставка после крэша = повторное списание кредитов); `SessionData` — grab-bag 20+ полей с живыми `@deprecated`; нет fallback-модели при отказе провайдера (вторая половина решения инцидента 429); if-цепочка «ожидающих текст» флагов без спецификации приоритета | `types.ts:26-209`, `mode-router.ts:80-93` |

---

## Admin / admin-api / landing

Сильные стороны: bcrypt без дефолтных кредов (seed требует env), единый «Invalid credentials», обязательный `JWT_SECRET`, zod на телах, параметризованный Drizzle, аудит-лог изменений AI-моделей. Landing — безрисковая статика.

| # | Sev | Находка | Где |
|---|-----|---------|-----|
| D1 | HIGH | → S2, S3, S4 (брутфорс логина, публичные отчёты, неотзываемый JWT) | — |
| D2 | MED | Можно удалить default/используемую AI-модель без guard'а; `set-default` не проверяет `isEnabled`/доступность; бот падает на захардкоженный fallback `openai/gpt-5-nano` — родственник инцидента 429 | `routes/ai-models.ts:229-254`, `core/.../settings.service.ts:282` |
| D3 | MED | Толстые контроллеры: маршруты ходят прямо в репозитории/сырой Drizzle, core импортируется только как типы; дефолты настроек продублированы между route-файлами и core | `routes/users.ts:41-72`, `routes/stats.ts:20-50`, `routes/ai-defaults.ts:15-21` |
| D4 | LOW | Дублирование zod-контрактов admin ↔ admin-api (дрейф неизбежен); auth-хук в 11 копиях; новый CRUD = ~6 точек copy-paste (паттерн консистентен, но без фабрики) | `apps/admin/src/lib/validation.ts` + route-файлы |
| D5 | LOW | `?limit` без клампа (выгрузка всей таблицы users), `total` игнорирует search, `days` не клампится в stats; метрика `activeToday` считает регистрации, а не активность (есть честный `last_interaction_at`) | `routes/users.ts:37-39,68`, `routes/stats.ts:26-31,56-70` |
| D6 | LOW | CORS: `http://localhost:4321` всегда разрешён в проде; исходящие fetch к OpenRouter без таймаута | `index.ts:37`, `ai-models.ts:155,184` |

---

## Слой БД

Сильные стороны: репозиторный паттерн выдержан (сырой Drizzle вне adapter-db — только в двух admin-роутах), продуманные `onDelete`, составные индексы под основные запросы, критичная запись словаря в транзакции, seed-миграции после инцидента 42703 идемпотентны и прокомментированы.

| # | Sev | Находка | Где |
|---|-----|---------|-----|
| E1 | CRIT | → C2 (уникальный индекс vs soft-delete) | `schema.ts:178` |
| E2 | HIGH | Горячие запросы `word_context` без индексов: `ilike(word,…)` (btree не работает) + `arrayContains(forms,…)` (нужен GIN, его нет) — seq scan на каждый перевод по kaikki-дампам | `word-context.repository.ts:35,52` |
| E3 | HIGH | `findByUserAndLang` тянет переводы ВСЕХ пользователей по targetLangId, фильтрует в JS — линейная деградация от объёма базы | `vocabulary.repository.ts:259-266` |
| E4 | HIGH | Гонка check-then-insert в auth-middleware: параллельные апдейты нового пользователя → unique violation на `telegram_id` | `apps/bot/src/middlewares/auth.ts:22-29` |
| E5 | HIGH | Нет retention/партиционирования: `dictionary_lookup_logs` (строка на lookup!), `translation_requests`, timings, latencies, `notification_history`, `bot_sessions` растут навсегда; rate-limit агрегирует `sum(credit_cost)` по вечной таблице | вся телеметрия |
| E6 | MED | Все timestamps без time zone (0 вхождений `withTimezone`) — SRS-даты/окна уведомлений/rate-limit корректны только пока Postgres и Node в UTC | `schema.ts` |
| E7 | MED | Беспорядок миграций: дубли номеров 0015/0017, номера 0018 нет; `0015_custom_notification_time.sql` отсутствует в `_journal.json` — мёртвый файл; `0002` всё ещё вставляет `iso3_code` (мина при squash истории) | `drizzle/` |
| E8 | MED | Гонка `getOrCreateDefault` (дубль дефолтного словаря); `updateAllTranslations` = delete+insert — уничтожает SRS-прогресс при регенерации карточки | `vocabulary-dictionary.repository.ts:59-79`, `vocabulary.repository.ts:346-383` |
| E9 | MED | `users.subscription_plan` — text без FK на `rate_limit_plans` (комментарий обещает переназначение, БД не гарантирует); дедуп словаря регистрозависим («Hello» ≠ «hello», при том что lookup нормализует NFC+lower); rate-limit check-then-log не атомарен | `schema.ts:105,504-518`, `translation-request.repository.ts:14-74` |
| E10 | LOW | jsonb без рантайм-валидации (сессии/настройки — zod только compile-time); text вместо pgEnum для статусов (непоследовательно с enum'ами audience/role); нетранзакционные `moveEntry` и soft-delete entry+translations; `schema.ts` импортирует типы из репозиториев (инверсия слоёв); один `DATABASE_URL` для бота/админки/drizzle-kit — нет least-privilege; offset-пагинация словаря; фильтрация таймзон уведомлений в JS | `schema.ts:17,451,494,720`, `connection.ts:18-23`, `notification.repository.ts:98-123` |

---

## Инфраструктура и деплой

Сильные стороны: multi-stage non-root Dockerfile-ы, `--frozen-lockfile`, все порты за `127.0.0.1` (нейтрализует «Docker обходит UFW»), mem-limits и лог-ротация везде, UFW + SSH-hardening, идемпотентный certbot, managed Postgres (Neon), секретов в репо нет.

| # | Sev | Находка | Где |
|---|-----|---------|-----|
| F1 | CRIT | → C4 (liveness-only healthz, ноль алертов) | `metrics.ts:126-128`, `deploy/monitoring/` |
| F2 | CRIT | → C5 (нет health-гейта/отката, миграции под старым кодом, prune убивает rollback-образы) | `.github/workflows/deploy.yml:166-178` |
| F3 | HIGH | Один VPS — SPOF без DR-runbook: `.env` со всеми секретами, данные Grafana/Prometheus/Loki, TLS-сертификаты не бэкапятся; процедура «VPS умер» не описана | `@docs/deployment-checklist.md` |
| F4 | HIGH | Monitoring-стек целиком на `:latest` + `pull` при каждом деплое — неконтролируемые мажорные апгрейды (Loki ломает схемы хранения между мажорами) | `docker-compose.monitoring.yml:3-91` |
| F5 | HIGH | nginx без security-заголовков и TLS-hardening: нет HSTS, X-Content-Type-Options, X-Frame-Options/CSP, ssl_protocols, client_max_body_size, limit_req | `deploy/ansible/site.yml:206-353,424-487` |
| F6 | MED | Конфликт Ansible ↔ certbot `--nginx`: installer дописывает конфиг, следующий прогон Ansible перезаписывает шаблоном; renewal может конфликтовать → `certbot certonly --webroot` | `site.yml:384-405` |
| F7 | MED | Все секреты в одном plaintext `.env` без `chmod 600`; `env_file: .env` отдаёт боту чужой `JWT_SECRET` | `deploy.yml:125-149`, `docker-compose.yml:6-8` |
| F8 | MED | `privileged: true` у cAdvisor + docker.sock у Promtail в сочетании с `:latest`; positions Promtail в `/tmp` (дубликаты логов после рестарта); TOFU ssh-keyscan + third-party actions pinned по мутабельному тегу с SSH-ключом прода | `docker-compose.monitoring.yml:66-67,94`, `promtail.yml:5`, `deploy.yml:142,152` |
| F9 | MED | Migrate-образ = полный build-стейдж под root с прод-DATABASE_URL; admin-api без `/metrics`; нет внешней uptime-проверки (падение VPS целиком никто не заметит); нет CPU-лимитов | `deploy/Dockerfile:80-84`, `prometheus.yml:5-20` |
| F10 | LOW | fail2ban ставится, но не конфигурируется (sshd-jail работает случайно); дублирующиеся healthcheck (Dockerfile + compose); seed-шаг деплоя декоративен (без env всегда skip) | `site.yml:21-31`, `deploy.yml:168` |

---

## Расширяемость: что сломается через 2–3 шага

- **Новый язык** — сегодня ~7 файлов в 3 пакетах + строка в БД (A6), плюс два реестра метаданных (A3), плюс риск-скоринг сделает язык «дорогим» (A2/COMMON_TRANSLATION_LANGS), плюс ручные `I18nKey`/`I18nParams` (A20). Нужен один источник-массив + компайл-тест «каждый supported-язык имеет traits/скрипт/локаль».
- **Новый AI-провайдер (мимо OpenRouter)** — синглтон клиента с env внутри (A17), захардкоженные ID и цены (A2, A8), игнорируемые defaults (A4). `AIPort` сам по себе хорош — менять пришлось бы core, чего быть не должно.
- **Новый канал (WhatsApp/web)** — telegramId как первичная идентичность в core-портах (A1), обязательный BOT_TOKEN в infra (A18), «Telegram bot» в core-промптах и локализованные UI-строки из домена (A13). Нужна таблица identities (userId, channel, externalId) и нейтральный userId в портах.
- **Новый тип упражнений/уведомлений** — закрытый union в двух портах + switch в scheduler (A19), опциональные deps notification-сервиса (A16). Нужен реестр «тип → picker».
- **Рост аудитории** — неиндексированный `word_context` на каждый перевод (E2), вечные лог-таблицы (E5), `translationMap` без эвикции (B6), `findByUserAndLang` по всем пользователям (E3), фильтрация таймзон в JS (E10).
- **Горизонтальное масштабирование / webhook** — in-process `sequentialize` + сессии без optimistic locking (B14), отсутствие идемпотентности по update_id (B15). Ограничение нигде не задокументировано.
- **Платные планы** — rate-limit гонка check-then-log (E9), AI-фичи вне квоты (S1, S5), двоевластие PLAN_LIMITS (A7).

---

## Приоритизированный план

**Сейчас (дни, до коммита текущего diff):**
1. C1 — добавить `mentor` в `VALID_MODES` + тест на каждый member `UserMode`.
2. B9 — починить diff: локализовать строки, разделить ошибки лимита/БД, убрать single-slot race, добавить `tr:oos` в реестр контрактов.
3. C3 — убрать `as unknown as ServiceContainer`, выровнять `estimateCost`.
4. C2 — частичный уникальный индекс + реактивация при повторном сохранении.
5. S2/H3 — rate-limit на `/api/auth/login` (fastify + nginx `limit_req`).
6. S3 — закрыть `apps/admin/public/reports/` (nginx basic auth / IP allowlist).

**Ближайший месяц:**
7. C4 — readiness-проверка + 3–4 alert rules + contact point (закрывает повторение инцидента 429).
8. C5 — health-гейт после `up -d`, rollback-тег, expand/contract для миграций.
9. S1/S5 — единая точка списания кредитов для всех AI-вызовов (mentor, dictionary, video, grammar/etymology) — совпадает с планом unified queue.
10. B4/B5 — `auto-retry` + throttler grammY; 403 → `disableNotifications`.
11. B3 — безопасный `bot.catch` с best-effort ответом пользователю.
12. S4 — проверка `isActive` в auth-хуке admin-api (+ убрать 11 копий хука).
13. E2 — нормализованный `word` + GIN на `forms`; E4 — get-or-create через `onConflictDoNothing`.
14. B6 — LRU-эвикция `translationMap`.
15. F4/F5 — pin monitoring-образов, nginx security-заголовки + TLS-hardening.

**Квартал (архитектурные инвестиции):**
16. Ликвидация двоевластия: удалить `PLAN_LIMITS` (A7), цены моделей из БД (A8), подключить `AIGenerationDefaults` (A4), judge-модель из настроек (A2), один языковой реестр (A3).
17. B2/B7 — извлечь `runTranslationPipeline`, разрезать translate-mode.helper, перевести прямые импорты adapter-db в `ctx.services` (снимет боль vi.mock на dist).
18. A12 — конвейер шагов в `translate()`; A1/A18 — identities-таблица и нейтральный userId в портах (фундамент мультиканальности).
19. E5 — retention для телеметрии (90 дней) или партиционирование; E6 — `withTimezone` для новых колонок.
20. F3 — DR-runbook; E7 — уборка миграций (мёртвый 0015, документировать журнал как источник порядка).
21. D3/D4 — сервисный слой в admin-api + общий пакет контрактов; A14 — allowlist-правила dependency-cruiser, поднять scenes-правило до error.
