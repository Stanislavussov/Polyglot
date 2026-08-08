# Weekly Grafana Reports

Регулярный разбор продакшена по данным Grafana (Prometheus + Loki), Neon и коду.
Один отчёт — один файл `YYYY-MM-DD.md` в этой папке, дата = день снятия среза.

**Зачем.** Метрики и алерты показывают состояние «сейчас». Еженедельный срез отвечает на
другой вопрос: что деградировало за неделю, что стоит денег, и — отдельно — **можно ли
доверять самим приборам**. Первый же разбор (2026-08-04) нашёл, что продукт здоров, а
сломан весь защитный контур: autoheal, failover и половина алертов.

---

## Регламент

- **Периодичность:** раз в неделю, окно — последние 7 дней (первый отчёт снят за 3 дня).
- **Результат:** файл-отчёт + таски в [`@docs/tasks`](../../tasks/README.md) на всё, что
  требует изменений в коде или инфраструктуре. Отчёт без тасок — это просто чтение графиков.
- **Ссылки в обе стороны:** отчёт ссылается на созданные таски, таска — на отчёт-источник.
- **Следующий отчёт открывается** с проверки acceptance-критериев тасок из предыдущего.

## Обязательные разделы

| # | Раздел | На что смотреть |
|---|---|---|
| 1 | Общая картина | uptime, рестарты, объём трафика, число пользователей |
| 2 | Скорость | p50/p95 перевода, обработки апдейта, фазы конвейера, латентность БД |
| 3 | Ошибки | все `level=50`, цепочка причин до корня, а не только верхняя ошибка |
| 4 | Качество переводов | доля провалов валидации, разбивка по правилам, словарные попадания |
| 5 | Избыточные запросы | пустые тики шедулера, health-check-шум, самологирование стека |
| 6 | Нагрузка на сервер | CPU/RAM/диск/сеть — и рост диска за период |
| 7 | Состояние мониторинга | мёртвые метрики, ложные и не-срабатывающие алерты, пустые панели |
| 8 | Что чинить | приоритезированный список → таски |

Раздел 7 не факультативный: панель, читающая несуществующую метрику, выглядит ровно как
панель, у которой всё хорошо.

---

## Кукбук запросов

Инструменты: Grafana MCP (`query_prometheus`, `query_loki_logs`, `alerting_manage_rules`,
`grafana_api_request`), Neon MCP (`run_sql`). Datasource UID: `prometheus`, `loki`.

### Трафик и надёжность

```promql
sum by (status) (increase(bot_translations_total[7d]))
sum by (type) (increase(bot_telegram_messages_total[7d]))
increase(bot_boot_total[7d])                      # рестарты бота
increase(bot_runner_death_detected_total[7d])
(time() - process_start_time_seconds{job="bot"}) / 3600   # uptime, ч
```

### Скорость

```promql
histogram_quantile(0.95, sum by (le) (rate(bot_translation_duration_seconds_bucket[7d])))
histogram_quantile(0.95, sum by (le, update_type) (rate(bot_update_handling_duration_seconds_bucket[7d])))
histogram_quantile(0.95, sum by (le) (rate(bot_update_delivery_lag_seconds_bucket[7d])))
histogram_quantile(0.95, sum by (le, op) (rate(bot_session_storage_duration_seconds_bucket[7d])))

# средняя длительность фазы
sum by (phase) (increase(bot_translation_phase_duration_seconds_sum[7d]))
  / sum by (phase) (increase(bot_translation_phase_duration_seconds_count[7d]))
```

### Ошибки и качество (Loki)

```logql
sum by (container_name, level) (count_over_time({level=~"40|50"}[7d]))
sum by (msg) (count_over_time({container_name="polyglot_bot"} | json | __error__="" [7d]))
{container_name="polyglot_bot", level="50"}        # читать целиком, до корня цепочки
```

### Объём логов (раздел «избыточные запросы»)

```logql
sum by (container_name) (count_over_time({container_name=~".+"}[7d]))
topk(15, sum by (url) (count_over_time({container_name="polyglot_admin_api"} | json url="req.url" | url != "" [7d])))
```

### Нагрузка

```promql
100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[7d])) * 100)
(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100
100 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"} * 100)
(node_filesystem_avail_bytes{mountpoint="/"} offset 7d - node_filesystem_avail_bytes{mountpoint="/"}) / 1024 / 1024   # рост диска, МБ
process_resident_memory_bytes{job="bot"} / 1024 / 1024
```

### AI: стоимость, латентность, фоллбэк (Neon)

```sql
SELECT model_id, request_kind, success, count(*) n,
       round(avg(duration_ms)) avg_ms,
       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)) p95_ms,
       sum(input_tokens) in_tok, sum(output_tokens) out_tok,
       round(sum(cost_usd)::numeric, 5) cost
FROM ai_request_latencies
WHERE created_at > now() - interval '7 days'
GROUP BY 1,2,3 ORDER BY n DESC;
```

```sql
SELECT request_type, success, count(*) n,
       round(avg(total_ms)) avg_total,
       round(percentile_cont(0.95) WITHIN GROUP (ORDER BY total_ms)) p95_total,
       round(avg(preflight_ms)) avg_pre, round(avg(db_lookup_ms)) avg_db, round(avg(ai_request_ms)) avg_ai
FROM translation_request_timings
WHERE created_at > now() - interval '7 days'
GROUP BY 1,2 ORDER BY n DESC;
```

```sql
SELECT lang_code, matched, count(*) n FROM dictionary_lookup_logs
WHERE created_at > now() - interval '7 days' GROUP BY 1,2 ORDER BY n DESC;
```

Neon compute (`active_time`, `cpu_used_sec` за биллинговый период) — из
`list_projects`, проект `polyglot` / `odd-hat-07896464`.

### Проверка самих приборов

```
alerting_manage_rules(operation="list")                 # состояния правил
GET /api/v1/provisioning/alert-rules                    # выражения — искать мёртвые метрики
GET /api/annotations?type=alert&from=…&to=…             # что реально срабатывало за период
get_dashboard_panel_queries(uid="polyglot-bot")         # сверить каждую метрику панели с реестром
list_prometheus_metric_names(regex="bot_.*")            # реестр существующих метрик
```

Правило разбора: у каждого алерта и панели сверять метрику с реестром. `or vector(0)`
и `no_data_state: OK` превращают «телеметрии нет» в «всё хорошо» — это надо ловить руками.

---

## Пороги «здорового» состояния

Базовая линия зафиксирована 2026-08-04; обновлять по мере закрытия тасок 72–76.

| Показатель | Целевое | 2026-08-04 |
|---|---|---|
| Перевод p95 | < 5 с | 7.4 с ❌ |
| Апдейт > 4 с | < 10% | 30% ❌ |
| Провалы валидации | < 10% запросов | 23% ❌ |
| Успешность фоллбэк-модели | > 50% | **0%** ❌ |
| Пустые тики шедулера | ~0% | 92% ❌ |
| Доля логов приложения в ингесте | заметная | 0.09% ❌ |
| Рост диска | ≤ 200 МБ / 7 дней | 183 МБ / 3 дня ❌ |
| Ложные алерты | 0 | 17 ❌ |
| Мёртвые алерты/панели | 0 | 3 алерта + 4 панели ❌ |
| CPU хоста | < 50% | 6.65% ✅ |
| Стоимость AI | — (наблюдаем) | $0.03 / день |

---

## Архив

| Дата | Окно | Итог |
|---|---|---|
| [2026-08-04](./2026-08-04.md) | 3 дня | Продукт здоров, защитный контур сломан целиком → таски 72–76 |
