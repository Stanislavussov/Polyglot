# Stack

| Layer             | Technology                                           | Reason                                                                                                |
| ----------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Runtime           | Node.js 22 LTS                                       | Stable, native fetch, good ecosystem for bots                                                         |
| Language          | TypeScript 5.x                                       | Strict typing, mandatory for reliability                                                              |
| Telegram Bot      | grammY 1.x                                           | Modern alternative to telegraf, middleware/scenes support                                             |
| DB                | PostgreSQL 16 (Railway managed)                      | Built into Railway, single deployment for everything                                                  |
| ORM               | Drizzle ORM                                          | Type-safe, SQL-first, lighter than Prisma                                                             |
| AI client         | Vercel AI SDK (`ai`) + `@openrouter/ai-sdk-provider` | `generateObject` returns a typed object directly via Zod, built-in retry, model switching in one line |
| Schema validation | Zod                                                  | Used together with Vercel AI SDK for typing AI responses                                              |
| Scheduler         | node-cron                                            | Cron jobs for notifications                                                                           |
| Hosting           | Railway Hobby ($5/mo) → Hetzner VPS (when scaling)   | Railway: bot + DB + deployment via git push in one place                                              |
| Logging           | Pino + Betterstack                                   | Structured logs, free tier 1GB/mo, 3-day retention, ready-made transport `@logtail/pino`             |
