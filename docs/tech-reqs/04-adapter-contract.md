# Adapter Contract (same interface, different implementation)

```tsx
// packages/adapters/notifications/types.ts

export interface NotificationAdapter {
  schedule(
    userId: number,
    time: "morning" | "evening",
    payload: NotificationPayload,
  ): void;
  cancel(userId: number): void;
}

// adapters/notifications/scheduler.node.ts  → node-cron (bot)
```

```tsx
// packages/adapters/db/types.ts

export interface UserRepository {
  findByTelegramId(telegramId: number): Promise<User | null>;
  create(data: NewUser): Promise<User>;
  updateSettings(
    userId: number,
    settings: Partial<UserSettings>,
  ): Promise<User>;
}

// adapters/db/pg/user.repository.ts     → PostgreSQL (bot)
```
