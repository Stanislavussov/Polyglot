/**
 * Helpers for user-facing long operations (AI requests, cold Neon queries):
 * bound them with a timeout so the user never stares at an endless loader,
 * and show a typing indicator during silent pre-phases.
 */
import { type SupportedLang, t } from "@polyglot/core";
import type { InlineKeyboardMarkup } from "grammy/types";
import type { BotContext } from "../types.js";

/** How long a user-facing operation may run before we give up and say so. */
export const LONG_OP_TIMEOUT_MS = 20_000;

/** Callback data for the inert loading button; answered with an empty ack. */
export const NOOP_CALLBACK = "noop";

/**
 * Inline keyboard with a single inert "⏳ Loading…" button — the persistent
 * loading state shown on a card while its long operation runs (the native
 * Telegram button spinner cannot be held open, so the keyboard carries it).
 */
export function loadingKeyboard(lang: SupportedLang = "en"): InlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: t("loading", lang), callback_data: NOOP_CALLBACK }]] };
}

export class OperationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Operation timed out after ${timeoutMs}ms`);
    this.name = "OperationTimeoutError";
  }
}

/**
 * Resolves with the work's outcome if it settles within `timeoutMs`,
 * otherwise rejects with OperationTimeoutError. The underlying work is
 * not cancelled — its late result is simply discarded.
 */
export async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new OperationTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fire-and-forget "typing…" chat action. Covers silent pre-phases (language
 * detection, quota checks) before a loader message appears. Never throws.
 */
export function sendTypingIndicator(ctx: BotContext): void {
  try {
    void ctx.replyWithChatAction("typing").catch(() => undefined);
  } catch {
    // A cosmetic indicator must never break the flow.
  }
}
