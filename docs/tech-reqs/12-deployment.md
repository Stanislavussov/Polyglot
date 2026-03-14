# Deployment on Railway

```
Railway Project
├── Service: bot (Node.js process)
│     ├── grammY        — long-polling, listens to Telegram messages
│     ├── node-cron     — notifications, runs inside the same process
│     └── Drizzle ORM   — DB connection
│
└── Service: PostgreSQL (Railway managed)
```

No HTTP API by design — Telegram delivers messages to the bot itself.
