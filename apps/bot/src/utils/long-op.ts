/**
 * Helpers for user-facing long operations (AI requests, cold Neon queries):
 * bound them with a timeout so the user never stares at an endless loader,
 * and show a typing indicator during silent pre-phases.
 */
import { AITimeoutError, type SupportedLang, t } from "@polyglot/core";
import type { InlineKeyboardMarkup } from "grammy/types";
import type { BotContext } from "../types.js";

/** How long a user-facing operation may run before we give up and say so. */
export const LONG_OP_TIMEOUT_MS = 20_000;

/**
 * Safety margin between the AI request budget and the outer op guard (B8). The
 * AI adapter's per-request budget is admin-managed (DB `ai.defaults`), so it can
 * be raised above {@link LONG_OP_TIMEOUT_MS}. If it were, the outer `withTimeout`
 * guard would abandon the await while the AI call kept spending — a leaked,
 * still-billing request. {@link clampAiBudgetToOpGuard} bounds the budget this
 * many ms below the outer guard so the adapter always aborts first, freeing the
 * socket and provider slot before the user-facing guard fires.
 */
export const AI_BUDGET_SAFETY_MARGIN_MS = 2_000;

/**
 * Bounds an admin-configured AI request budget strictly below the outer op guard
 * so the AI adapter cancels first (B8). Invariant: the returned value is always
 * `<= LONG_OP_TIMEOUT_MS - AI_BUDGET_SAFETY_MARGIN_MS < LONG_OP_TIMEOUT_MS`.
 */
export function clampAiBudgetToOpGuard(budgetMs: number): number {
  return Math.min(budgetMs, LONG_OP_TIMEOUT_MS - AI_BUDGET_SAFETY_MARGIN_MS);
}

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
 * True when `err` should surface the friendly "taking longer, try again"
 * fallback rather than a hard error — either the op-level guard fired
 * (OperationTimeoutError) or the AI adapter aborted a call that blew its time
 * budget (AITimeoutError, thrown before this guard since its budget is lower).
 */
export function isUserFacingTimeout(err: unknown): boolean {
  return err instanceof OperationTimeoutError || err instanceof AITimeoutError;
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

/** Telegram clears the "typing…" action after ~5s, so refresh it below that. */
const TYPING_KEEPALIVE_MS = 4_000;

/**
 * Holds the "typing…" chat action open for the length of a long operation by
 * re-sending it on an interval (a single {@link sendTypingIndicator} lapses
 * after ~5s while a translation can run up to {@link LONG_OP_TIMEOUT_MS}).
 * Returns a stop function that MUST be called — attach it with `.finally()` so
 * the interval is always cleared, on both success and failure.
 */
export function startTypingKeepalive(ctx: BotContext): () => void {
  sendTypingIndicator(ctx);
  const interval = setInterval(() => sendTypingIndicator(ctx), TYPING_KEEPALIVE_MS);
  return () => clearInterval(interval);
}
