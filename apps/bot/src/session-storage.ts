import { BOT_SESSION_VERSION, botSessionRepository } from "@polyglot/adapter-db";
import { logger } from "@polyglot/core";
import type { StorageAdapter } from "grammy";
import { sessionStorageDuration } from "./metrics.js";
import { type SessionData, USER_MODES, type UserMode } from "./types.js";

async function timed<T>(op: "read" | "write" | "delete", fn: () => Promise<T>): Promise<T> {
  const stop = sessionStorageDuration.startTimer({ op });
  try {
    return await fn();
  } finally {
    stop();
  }
}

/** Derived from the single source of truth so no mode can be forgotten here. */
const VALID_MODES = new Set<UserMode>(USER_MODES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidMode(mode: unknown): mode is UserMode {
  return typeof mode === "string" && VALID_MODES.has(mode as UserMode);
}

export function isValidSessionData(value: unknown): value is SessionData {
  return isRecord(value) && isValidMode(value.activeMode);
}

/**
 * Non-destructively repair a stored session payload keyed by session version.
 * An invalid/unknown `activeMode` is defaulted in place while every other field
 * (translationMap, mentor history, pending state) is preserved — a single bad
 * field must never wipe the whole session. Returns undefined only when the
 * payload is not an object at all (nothing salvageable).
 */
export function migrateSessionData(value: unknown): SessionData | undefined {
  if (isValidSessionData(value)) return value;
  if (!isRecord(value)) return undefined;
  return {
    ...(value as Partial<SessionData>),
    activeMode: isValidMode(value.activeMode) ? value.activeMode : "translate",
  } as SessionData;
}

export function createPostgresSessionStorage(): StorageAdapter<SessionData> {
  return {
    async read(key) {
      return timed("read", async () => {
        const row = await botSessionRepository.get(key);
        if (!row) return undefined;

        if (isValidSessionData(row.data)) return row.data;

        const repaired = migrateSessionData(row.data);
        if (!repaired) {
          logger.warn({ sessionKey: key }, "Resetting unrecoverable bot session");
          await botSessionRepository.delete(key);
          return undefined;
        }

        logger.warn({ sessionKey: key }, "Repaired bot session (defaulted invalid activeMode)");
        await botSessionRepository.upsert(key, repaired);
        return repaired;
      });
    },

    async write(key, value) {
      await timed("write", () => botSessionRepository.upsert(key, value));
    },

    async delete(key) {
      await timed("delete", () => botSessionRepository.delete(key));
    },
  };
}

export { BOT_SESSION_VERSION };
