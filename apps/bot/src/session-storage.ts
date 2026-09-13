import { BOT_SESSION_VERSION, botSessionRepository, USER_MODES, type UserMode } from "@polyglot/adapter-db";
import { logEvent } from "@polyglot/core";
import type { StorageAdapter } from "grammy";
import { sessionStorageDuration } from "./metrics.js";
import type { SessionData } from "./types.js";

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
 * The decks sessions carried before Cards replaced flashcards and `/review` (Task 85).
 * Nothing reads them, and grammY writes the whole session back on every update, so
 * left alone they would be stored forever.
 */
function hasLegacyDecks(value: object): boolean {
  return "flashcard" in value || "srs" in value;
}

/**
 * Non-destructively repair a stored session payload keyed by session version.
 * An invalid/unknown `activeMode` is defaulted in place and the pre-Task-85 decks are
 * dropped, while every other field (translationMap, mentor history, pending state) is
 * preserved — a single bad field must never wipe the whole session. Returns undefined
 * only when the payload is not an object at all (nothing salvageable).
 */
export function migrateSessionData(value: unknown): SessionData | undefined {
  if (!isRecord(value)) return undefined;
  const { flashcard: _flashcard, srs: _srs, ...rest } = value;
  const repaired = { ...rest, activeMode: isValidMode(value.activeMode) ? value.activeMode : "translate" };
  return isValidSessionData(repaired) ? repaired : undefined;
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
    cardsDeckSize: data.cards?.deck.length ?? 0,
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

        if (isValidSessionData(row.data) && !hasLegacyDecks(row.data)) {
          logEvent("session.loaded", { sessionKey: key, ...summariseSession(row.data) }, "debug");
          return row.data;
        }

        const repaired = migrateSessionData(row.data);
        if (!repaired) {
          logEvent("session.reset", { sessionKey: key, reason: "unrecoverable_payload" }, "warn");
          await botSessionRepository.delete(key);
          return undefined;
        }

        const reason = isValidSessionData(row.data) ? "legacy_decks" : "invalid_active_mode";
        logEvent("session.repaired", { sessionKey: key, reason }, "warn");
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
