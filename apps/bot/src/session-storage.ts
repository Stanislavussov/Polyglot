import { BOT_SESSION_VERSION, botSessionRepository } from "@polyglot/adapter-db";
import { logger } from "@polyglot/core";
import type { StorageAdapter } from "grammy";
import type { SessionData, UserMode } from "./types.js";

const VALID_MODES = new Set<UserMode>(["idle", "translate"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isValidSessionData(value: unknown): value is SessionData {
  if (!isRecord(value)) return false;
  return typeof value.activeMode === "string" && VALID_MODES.has(value.activeMode as UserMode);
}

export function createPostgresSessionStorage(): StorageAdapter<SessionData> {
  return {
    async read(key) {
      const row = await botSessionRepository.get(key);
      if (!row) return undefined;

      if (isValidSessionData(row.data)) return row.data;

      logger.warn({ sessionKey: key }, "Resetting corrupt bot session");
      await botSessionRepository.delete(key);
      return undefined;
    },

    async write(key, value) {
      await botSessionRepository.upsert(key, value);
    },

    async delete(key) {
      await botSessionRepository.delete(key);
    },
  };
}

export { BOT_SESSION_VERSION };
