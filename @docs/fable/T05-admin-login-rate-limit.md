# T05 — Rate-limit и anti-bruteforce на `/api/auth/login`

- **Приоритет:** P0 (публичный эндпоинт в интернете без защиты)
- **Фаза:** 1 — Безопасность
- **Оценка:** ~1 день
- **Зависит от:** —
- **Блокирует:** —
- **Связано:** [T06](T06-admin-token-revocation.md), [T20](T20-monitoring-pins-nginx-hardening.md) (nginx `limit_req`)
- **Находки:** S2

## Проблема

`apps/admin-api/src/routes/auth.ts:12-30` — `POST /login` публично доступен через nginx (домен `ADMIN_API_DOMAIN`), `@fastify/rate-limit` в зависимостях нет, нет ни лимита попыток, ни задержек, ни lockout. Пароль сверяется bcrypt (хорошо), но перебор ничем не ограничен.

## Затронутые файлы

- `apps/admin-api/src/index.ts:33-60` — регистрация плагинов.
- `apps/admin-api/src/routes/auth.ts:12-30` — маршрут логина.
- `deploy/ansible/site.yml:264-281` — nginx location для admin-API (координация с [T20](T20-monitoring-pins-nginx-hardening.md)).

## Решение

1. Подключить `@fastify/rate-limit`: жёсткий лимит на `/login` (например 5 попыток/мин на IP+email), мягкий глобальный на остальные маршруты.
2. Логировать неудачные попытки логина (для будущих алертов; координация с [T10](T10-pino-redact-pii.md) — не логировать пароль).
3. Второй слой на границе — `limit_req_zone` в nginx для `/login` (сделать в рамках [T20](T20-monitoring-pins-nginx-hardening.md)).
4. Рассмотреть экспоненциальную задержку/временный lockout по ключу email+IP после N неудач.

## Критерии приёмки

- [ ] Более N попыток логина в минуту с одного IP → 429.
- [ ] Успешный логин по-прежнему работает в пределах лимита.
- [ ] Неудачные попытки логируются без утечки пароля.

## Тесты (spec-first)

- Integration-тест: N+1 запросов на `/login` → последний получает 429.
- Тест, что легитимный логин не блокируется в норме.

## Примечания

Единый ответ «Invalid credentials» уже есть (нет user enumeration) — сохранить. JWT живёт 24 ч без отзыва — это отдельная задача [T06](T06-admin-token-revocation.md).
