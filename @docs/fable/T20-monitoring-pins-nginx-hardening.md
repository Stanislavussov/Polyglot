# T20 — Pin monitoring-образов + hardening nginx

- **Приоритет:** P1 (High)
- **Фаза:** 2 — Устойчивость и наблюдаемость
- **Оценка:** ~1.5 дня
- **Зависит от:** —
- **Блокирует:** —
- **Связано:** [T09](T09-close-public-reports.md), [T13](T13-deploy-health-gate-rollback.md)
- **Находки:** F4, F5, S10

## Проблема

- **F4:** monitoring-стек целиком на `:latest` (`docker-compose.monitoring.yml:3-91`) + `pull` при каждом деплое → неконтролируемые мажорные апгрейды (Loki ломает схемы хранения между мажорами, Grafana — провижининг).
- **F5:** nginx без security-заголовков и TLS-hardening (`site.yml:206-353,424-487`): нет `ssl_protocols`/`ssl_ciphers`, HSTS, `X-Content-Type-Options`, `X-Frame-Options`/CSP, `client_max_body_size`, таймаутов, `limit_req`.
- **S10:** bootstrap-фаза nginx проксирует логин админки/Grafana по чистому HTTP до выпуска сертификата (`site.yml:226-242,306-340`).

## Затронутые файлы

- `deploy/monitoring/docker-compose.monitoring.yml:3-91`.
- `deploy/ansible/site.yml:206-353,424-487`.

## Решение

1. Pin monitoring-образов по минорной версии (`grafana:11.x`, `loki:3.x`, prometheus/promtail/node-exporter/cadvisor), обновлять осознанно.
2. Общий nginx-сниппет: современный TLS (Mozilla intermediate), HSTS, `X-Content-Type-Options`, `X-Frame-Options`/CSP для админки, `client_max_body_size`, таймауты; `limit_req_zone` на `/login` (координация с [T05](T05-admin-login-rate-limit.md)).
3. Bootstrap-фаза: до выпуска сертификата отдавать 503/заглушку/только ACME-challenge, а не проксировать логин по HTTP.
4. Закрыть `/reports/` в nginx (немедленный шаг [T09](T09-close-public-reports.md)).

## Критерии приёмки

- [ ] Все monitoring-образы pinned, `pull` не тянет мажоры.
- [ ] Security-заголовки и HSTS присутствуют (проверить `curl -I`).
- [ ] Логин-формы недоступны по plain HTTP.

## Тесты (spec-first)

- Проверка `curl -I` по каждому домену: наличие HSTS/заголовков, отсутствие слабых TLS.
- Idempotency-прогон Ansible: повторный запуск не ломает конфиг (см. F6/[T30](T30-longtail-cleanup.md) про certbot `--nginx`).

## Примечания

**Провижининг прода — только по явному запросу пользователя** (CLAUDE.md Hard Rule #6, посадка как `db:migrate`). Перед новым доменом подтвердить DNS на VPS. Эта задача готовит изменения; применение `pnpm ansible` — отдельный явный шаг.
