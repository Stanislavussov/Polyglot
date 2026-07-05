# T09 — Закрыть публичную утечку `public/reports`

- **Приоритет:** P0 (утечка внутренней карты системы в интернет)
- **Фаза:** 1 — Безопасность
- **Оценка:** ~0.5 дня
- **Зависит от:** —
- **Блокирует:** —
- **Связано:** [T20](T20-monitoring-pins-nginx-hardening.md) (nginx)
- **Находки:** S3

## Проблема

`apps/admin/public/reports/` содержит `database-schema.html` (полная схема БД), `architecture-overview.html`, `observability.html`, `test-catalog.json` (~1951 сценариев с путями файлов и описанием поведения), `translation-quality-*`. Astro раздаёт `public/` статикой **без auth**, а nginx проксирует весь `localhost:4321` наружу (`deploy/ansible/site.yml:247-262`). Любой аноним получает полную карту системы для подготовки атаки.

## Затронутые файлы

- `apps/admin/public/reports/` — сами артефакты.
- `deploy/ansible/site.yml:247-262` — nginx location для админки.
- `scripts/sync-admin-reports.mjs`, `scripts/test-catalog.mjs` — генерация отчётов.

## Решение

Выбрать/скомбинировать:

1. **Немедленно:** закрыть `/reports/` в nginx (basic auth или IP allowlist) — минимальная правка периметра.
2. **Правильно:** отдавать отчёты через защищённый эндпоинт admin-api (за тем же JWT-хуком, что и остальное), не публиковать в `public/`.
3. Пересмотреть, что вообще должно попадать в `public/reports` (translation-quality — да, схема БД и test-catalog — нет).

## Критерии приёмки

- [ ] `GET https://<admin-domain>/reports/database-schema.html` без авторизации → 401/403 (или 404).
- [ ] Легитимный доступ к нужным отчётам сохранён (для админов).
- [ ] `test-catalog.json` и `database-schema.html` недоступны анонимно.

## Тесты (spec-first)

- Проверка периметра: анонимный запрос к каждому чувствительному отчёту не отдаёт 200 с содержимым.

## Примечания

Координация с CLAUDE.md: `test:catalog` пишет в `apps/admin/public/reports/` — если менять расположение, обновить и quality-gate инструкцию. Немедленный шаг (nginx) можно сделать в рамках [T20](T20-monitoring-pins-nginx-hardening.md); архитектурный (защищённый эндпоинт) — здесь.
