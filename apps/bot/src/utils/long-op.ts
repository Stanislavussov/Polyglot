/**
 * Helpers for user-facing long operations (AI requests, cold Neon queries):
 * bound them with a timeout so the user never stares at an endless loader,
 * and show a typing indicator during silent pre-phases.
 */
import {
  AICircuitOpenError,
  AITimeoutError,
  composeLoaderText,
  hasWaitPhrases,
  type LoaderKind,
  loaderEmoji,
  loaderPhraseKeys,
  type SupportedLang,
  t,
  waitPhrases,
} from "@polyglot/core";
import type { InlineKeyboardMarkup } from "grammy/types";
import type { BotContext } from "../types.js";

/** How long a user-facing operation may run before we give up and say so. */
export const LONG_OP_TIMEOUT_MS = 20_000;

/**
 * Wall-clock budget handed to the translation pipeline, which the caller turns
 * into `TranslateInput.deadlineAt`.
 *
 * Deliberately below {@link LONG_OP_TIMEOUT_MS}. The outer `withTimeout` guard is
 * a hard stop that abandons the request and shows the user an error; the pipeline
 * budget is a *graceful* bound that lets the post-generation tail (whole-batch
 * retry, targeted repair, semantic judge) stop starting new work and hand back the
 * best already-validated result instead. That degradation is only reachable if the
 * pipeline finishes *first*, so the gap between the two is the headroom the
 * pipeline needs to wind down — abandon an in-flight repair, fall back to the
 * validated result, and return — before the hard guard fires.
 *
 * The caller turns this into an ABSOLUTE deadline anchored at the same instant it
 * starts the `withTimeout` guard, so both clocks run from one origin. Note the
 * card-rendering round-trips happen *after* `withTimeout` resolves and are outside
 * the guard entirely; they are not what this margin is for.
 *
 * Invariant: `TRANSLATION_BUDGET_MS < LONG_OP_TIMEOUT_MS`.
 */
export const TRANSLATION_BUDGET_MS = LONG_OP_TIMEOUT_MS - 3_000;

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
 * fallback rather than a hard error — the op-level guard fired
 * (OperationTimeoutError), the AI adapter aborted a call that blew its time
 * budget (AITimeoutError, thrown before this guard since its budget is lower), or
 * the Phase 3 circuit breaker fast-failed a request because a provider is already
 * down (AICircuitOpenError). All three warrant the same "try again shortly" notice
 * rather than a hard error message.
 */
export function isUserFacingTimeout(err: unknown): boolean {
  return err instanceof OperationTimeoutError || err instanceof AITimeoutError || err instanceof AICircuitOpenError;
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

/**
 * When the loader moves to its next phrase, in ms from the moment it appeared.
 *
 * Deliberately uneven and front-loaded: the first few seconds are where a user
 * starts wondering whether anything is happening, so the text moves twice before
 * most translations are even finished, then spaces out as the wait turns into a
 * long one. The last entry sits below {@link LONG_OP_TIMEOUT_MS}, so the final
 * phrase is on screen when the guard fires.
 */
const LOADER_TICK_OFFSETS_MS = [3_000, 5_000, 7_000, 10_000, 15_000] as const;

/** Gaps between consecutive ticks — what `setTimeout` actually needs. */
const LOADER_TICK_GAPS_MS = LOADER_TICK_OFFSETS_MS.map(
  (offset, index) => offset - (LOADER_TICK_OFFSETS_MS[index - 1] ?? 0),
);

/**
 * A loader message together with the ticker that keeps rewriting it.
 *
 * `stop()` MUST run before the message is deleted — otherwise the interval
 * outlives its message and keeps editing an id Telegram no longer knows.
 * {@link dismissLoader} does both in the right order.
 */
export interface Loader {
  chatId: number;
  messageId: number;
  stop: () => void;
}

function randomOf<T>(options: readonly T[]): T | undefined {
  return options[Math.floor(Math.random() * options.length)];
}

/**
 * Interface-language fallback line, used only for a user with no learning
 * language the loader can speak (mid-onboarding, or a language with no phrase
 * set of its own).
 */
function fallbackPhrase(kind: LoaderKind, stage: number, lang: SupportedLang, current?: string): string {
  const options = loaderPhraseKeys(kind, stage)
    .map((key) => t(key, lang))
    .filter((text) => text !== current);
  return randomOf(options) ?? current ?? "";
}

/**
 * The next line to show, never the one already on screen: Telegram rejects an
 * edit that leaves the text unchanged, and a repeat would read as a frozen bot.
 *
 * `rotation` is the user's own learning languages, so each tick speaks a
 * different one of them — a wait that used to be dead air now spends it on the
 * colloquial filler those languages actually use.
 */
function nextLoaderText(
  kind: LoaderKind,
  stage: number,
  lang: SupportedLang,
  rotation: readonly string[],
  current?: string,
): string {
  const langCode = rotation[stage % rotation.length];
  if (langCode === undefined) return fallbackPhrase(kind, stage, lang, current);

  const emoji = randomOf(loaderEmoji(kind));
  const options =
    emoji === undefined
      ? []
      : waitPhrases(langCode, stage)
          .map((phrase) => composeLoaderText(emoji, phrase))
          .filter((text) => text !== current);
  return randomOf(options) ?? fallbackPhrase(kind, stage, lang, current);
}

/**
 * Sends the loader message for a long operation and walks its text forward while
 * the operation runs: on the {@link LOADER_TICK_OFFSETS_MS} schedule, each step in
 * the next of the user's learning languages, drawn from the stage that matches how
 * long they have been waiting. Most translations finish inside the first tick and never
 * move — which is why the opening language is drawn at random rather than always
 * being the first one the user picked.
 */
export async function sendLoader(
  ctx: BotContext,
  kind: LoaderKind,
  lang: SupportedLang,
  learningLangs: readonly string[] = [],
): Promise<Loader> {
  const covered = learningLangs.filter(hasWaitPhrases);
  const offset = covered.length > 0 ? Math.floor(Math.random() * covered.length) : 0;
  const rotation = [...covered.slice(offset), ...covered.slice(0, offset)];

  let current = nextLoaderText(kind, 0, lang, rotation);
  // Captured now: the ticks fire long after the handler's own frame is gone.
  const chatId = ctx.chat!.id;
  const message = await ctx.reply(current);

  // A chain rather than an interval: the gaps are uneven, and each tick schedules
  // only the next one, so the ticker runs out on its own at the last offset.
  let stage = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = (): void => {
    stage += 1;
    current = nextLoaderText(kind, stage, lang, rotation, current);
    void ctx.api.editMessageText(chatId, message.message_id, current).catch(() => undefined);
    const gap = LOADER_TICK_GAPS_MS[stage];
    if (gap !== undefined) timer = setTimeout(tick, gap);
  };
  const firstGap = LOADER_TICK_GAPS_MS[0];
  if (firstGap !== undefined) timer = setTimeout(tick, firstGap);

  return { chatId, messageId: message.message_id, stop: () => clearTimeout(timer) };
}

/** Stops the ticker, then removes the loader message. Never throws. */
export async function dismissLoader(ctx: BotContext, loader: Loader): Promise<void> {
  loader.stop();
  await ctx.api.deleteMessage(loader.chatId, loader.messageId).catch(() => {});
}
