# T12 — Readiness-healthcheck + алерты Grafana

- **Приоритет:** P0 (без этого инцидент «завис на 429» повторится незамеченным)
- **Фаза:** 2 — Устойчивость и наблюдаемость
- **Оценка:** ~2 дня
- **Зависит от:** —
- **Блокирует:** [T13](T13-deploy-health-gate-rollback.md)
- **Связано:** [T14](T14-telegram-429-403-resilience.md)
- **Находки:** C4, F1

## Проблема

`apps/bot/src/metrics.ts:126-128` — `/healthz` всегда возвращает `{status:"ok"}` без проверки, что long-polling жив и AI-запросы проходят; docker-healthcheck опрашивает именно его. В Grafana provisioning (`deploy/monitoring/grafana/provisioning/`) нет ни alert rules, ни contact points; Alertmanager отсутствует в `prometheus.yml`. Известный инцидент (бот молча завис на 429) не был бы замечен и сегодня. Метрики для алертов уже есть — не хватает только правил.

## Затронутые файлы

- `apps/bot/src/metrics.ts:126-128` — healthz.
- `deploy/monitoring/prometheus/prometheus.yml`.
- `deploy/monitoring/grafana/provisioning/` — alert rules + contact points.

## Решение

1. **Readiness** отдельно от liveness: `/readyz` проверяет «последний успешный getUpdates < N сек назад» и ping БД; docker-healthcheck и/или деплой-гейт смотрят на него.
2. **Provisioned alert rules** (метрики уже есть):
   - рост `rate(bot_translations_total{status="error"})`;
   - тишина `bot_telegram_messages_total` за 10 мин (бот не обрабатывает апдейты);
   - `up{job="bot"} == 0`.
3. **Contact point** (Telegram-канал/email) + маршрутизация алертов.

## Критерии приёмки

- [ ] `/readyz` возвращает не-ok, если long-polling завис или БД недоступна.
- [ ] Есть минимум 3 provisioned-алерта с рабочим contact point.
- [ ] Тестовый инцидент (симуляция ошибок AI/тишины апдейтов) триггерит уведомление.

## Тесты (spec-first)

- Unit-тест readiness-эндпоинта: при устаревшем «last successful getUpdates» → не-ok.
- Проверка, что provisioning-файлы алертов валидны (загружаются Grafana без ошибок).

## Примечания

Фундамент для health-гейта деплоя [T13](T13-deploy-health-gate-rollback.md). Добавить `/metrics` для admin-api (F9) можно здесь же или в [T30](T30-longtail-cleanup.md). Рассмотреть внешнюю uptime-проверку доменов (падение VPS целиком иначе не заметит никто).
