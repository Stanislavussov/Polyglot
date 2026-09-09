import { BOT_SESSION_VERSION, botSessionRepository } from "@polyglot/adapter-db";
import { logEvent } from "@polyglot/core";
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

/**
 * A compact shape of the session, for logs.
 *
 * Never the session itself: it holds whole flashcard decks and translation maps
 * that would dwarf every other record. What actually matters when debugging a
 * dead button is which pending-state slots exist — a tap whose entry is missing
 * from `translationMap` is exactly the "session expired" failure users report.
 */
function summariseSession(data: SessionData): Record<string, unknown> {
  return {
    activeMode: data.activeMode,
    translationMapSize: Object.keys(data.translationMap ?? {}).length,
    pendingRetries: Object.keys(data.pendingRetries ?? {}).length,
    pendingOutOfSet: Object.keys(data.pendingOutOfSet ?? {}).length,
    flashcardDeckSize: data.flashcard?.deck.length ?? 0,
    srsDeckSize: data.srs?.deck.length ?? 0,
    hasMentorThread: data.mentor?.threadId !== undefined,
    hasDictionaryWizard: data.dictionaryWizard !== undefined,
    hasTemplateWizard: data.templateWizard !== undefined,
    hasPendingClarification: data.pendingClarification !== undefined,
  };
}

export function createPostgresSessionStorage(): StorageAdapter<SessionData> {
  return {
    async read(key) {
      return timed("read", async () => {
        const row = await botSessionRepository.get(key);
        if (!row) {
          // A miss on a callback tap is the signature of the "session expired"
          // reports: the button is live but the state behind it is gone.
          logEvent("session.miss", { sessionKey: key }, "debug");
          return undefined;
        }

        if (isValidSessionData(row.data)) {
          logEvent("session.loaded", { sessionKey: key, ...summariseSession(row.data) }, "debug");
          return row.data;
        }

        const repaired = migrateSessionData(row.data);
        if (!repaired) {
          logEvent("session.reset", { sessionKey: key, reason: "unrecoverable_payload" }, "warn");
          await botSessionRepository.delete(key);
          return undefined;
        }

        logEvent("session.repaired", { sessionKey: key, reason: "invalid_active_mode" }, "warn");
        await botSessionRepository.upsert(key, repaired);
        return repaired;
      });
    },

    async write(key, value) {
      await timed("write", () => botSessionRepository.upsert(key, value));
      logEvent("session.saved", { sessionKey: key, ...summariseSession(value) }, "debug");
    },

    async delete(key) {
      await timed("delete", () => botSessionRepository.delete(key));
      logEvent("session.deleted", { sessionKey: key });
    },
  };
}

export { BOT_SESSION_VERSION };
