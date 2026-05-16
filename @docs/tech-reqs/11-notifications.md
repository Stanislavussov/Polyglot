# Notifications (cron)

```tsx
// Two cron jobs: morning and evening
// Each picks users with the matching time and timezone

cron.schedule("0 8 * * *", () => sendNotifications("morning"));
cron.schedule("0 20 * * *", () => sendNotifications("evening"));

// Word selection logic:
// notifyTypes includes "suggested" → AI generates based on user's topics
```
