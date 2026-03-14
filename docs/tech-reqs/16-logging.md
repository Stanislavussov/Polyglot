# Logging

Pino writes structured JSON to stdout. Betterstack collects logs via transport.

## What We Log (mandatory)

| Event             | Fields                                                      |
| ----------------- | ----------------------------------------------------------- |
| AI request        | `model`, `tokens_used`, `cost_usd`, `duration_ms`, `userId` |
| Validation error  | `original`, `aiResponse`, `failReason`, `retryCount`        |
| Notification sent | `userId`, `type` (suggested), `wordId`                      |
| Bot error         | `error`, `userId`, `command`                                |

```tsx
// src/logger.ts
import pino from "pino";
import { Logtail } from "@logtail/node";
import { LogtailTransport } from "@logtail/pino";

const logtail = new Logtail(process.env.BETTERSTACK_TOKEN!);

export const logger = pino(
  { level: "info" },
  // In prod — write to Betterstack, locally — to stdout
  process.env.NODE_ENV === "production"
    ? LogtailTransport(logtail)
    : pino.destination(1),
);
```
