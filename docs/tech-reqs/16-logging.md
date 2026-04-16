# Logging

Pino writes structured JSON to stdout. Betterstack collects logs via transport.

## Single Implementation

**`packages/core/src/logger.ts`** — singleton pino instance. All packages import `logger` from `@polyglot/core`. No separate infra logger.

```ts
// packages/core/src/logger.ts
import pino from "pino";

const coreLogger = pino({ level: "info" }, pino.destination(1));
export { coreLogger as logger };
```

The `Logger` interface and `getLogger`/`setLogger` functions are in `packages/core/src/logger-interface.ts`. Core modules use them via relative import. External callers import `logger` directly from `@polyglot/core`.

## What We Log (mandatory)

| Event             | Fields                                                      |
| ----------------- | ----------------------------------------------------------- |
| AI request        | `model`, `tokens_used`, `cost_usd`, `duration_ms`, `userId` |
| Validation error  | `original`, `aiResponse`, `failReason`, `retryCount`        |
| Notification sent | `userId`, `type` (suggested), `wordId`                      |
| Bot error         | `error`, `userId`, `command`                                |

```tsx
// Betterstack transport (optional, production only)
import pino from "pino";
import { Logtail } from "@logtail/node";
import { LogtailTransport } from "@logtail/pino";

const logtail = new Logtail(process.env.BETTERSTACK_TOKEN!);

const logger = pino(
  { level: "info" },
  // In prod — write to Betterstack, locally — to stdout
  process.env.NODE_ENV === "production"
    ? LogtailTransport(logtail)
    : pino.destination(1),
);

// Wire Betterstack in composition root:
// import { logger } from "@polyglot/core";
// logger is already a pino instance — just configure transport here
```
