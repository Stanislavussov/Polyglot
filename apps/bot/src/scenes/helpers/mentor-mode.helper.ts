/**
 * Mentor mode helper — handles plain text messages when activeMode === "mentor"
 * and reply-continuations routed in from any mode.
 *
 * The user chats with an AI language assistant about grammar, usage, and idioms.
 * Conversation history lives in `mentor_messages` (DB), windowed to
 * MAX_MENTOR_HISTORY per thread; the session only pins the current thread id.
 */
import {
  type ChatMessage,
  FEATURE_KEYS,
  isSupported,
  logger,
  MAX_MENTOR_HISTORY,
  MENTOR_MAX_INPUT_LENGTH,
  resolveMentorSetup,
  type SupportedLang,
  t,
} from "@polyglot/core";
import { mentorCounter, mentorDuration } from "../../metrics.js";
import { markMentorActivity } from "../../modes/mode-policy.js";
import { recordEffort } from "../../momentum/momentum.wiring.js";
import type { BotContext } from "../../types.js";
import { buildAiFailover } from "../../utils/ai-model.js";
import { ensureAiQuota, ensureMentorDailyQuota, recordAiUsage } from "../../utils/ai-quota.js";
import {
  dismissLoader,
  isUserFacingTimeout,
  LONG_OP_TIMEOUT_MS,
  sendLoader,
  sendTypingIndicator,
  withTimeout,
} from "../../utils/long-op.js";
import { replyWithRetry } from "../../utils/retry-action.js";
import { mentorAnswerKeyboard } from "./mentor-exit.helper.js";
import { ensurePaidFeatureForMessage } from "./paid-feature.helper.js";

export { MENTOR_MAX_INPUT_LENGTH };

export interface MentorTurnOptions {
  /** Thread to continue (reply-continuation or retry); resolved from session/DB when absent. */
  threadId?: string;
  /**
   * Message id to anchor the user's turn to when the turn did not arrive as a
   * message: a held message resumed from a callback, or a card's "Ask the mentor"
   * button, where the card itself is what the question is about. Without it the
   * question would be missing from the thread's history and a follow-up would
   * read the answer with no question.
   */
  userMessageId?: number;
  /**
   * The part of `text` the user actually typed, when the turn's text is composed
   * rather than typed (a card question carries the whole card with it). The
   * length guard is about what a user may send, so it measures this — a composed
   * block is the bot's own doing and is bounded by the card it came from.
   */
  userInput?: string;
}

/**
 * Which thread this turn belongs to.
 *
 * `/mentor` writes a stamp without a `threadId` (fresh start, no recovery); a session
 * that lost the field entirely (restart, retention sweep) recovers the chat's
 * latest thread from the DB so an ongoing conversation survives session loss.
 */
async function resolveThreadId(ctx: BotContext, opts?: MentorTurnOptions): Promise<string> {
  if (opts?.threadId) return opts.threadId;
  const pinned = ctx.session.mentor?.threadId;
  if (pinned) return pinned;
  if (ctx.session.mentor === undefined && ctx.session.activeMode === "mentor" && ctx.chat) {
    const recovered = await ctx.services.mentorMessageRepository.findLatestThreadId(ctx.chat.id);
    if (recovered) return recovered;
  }
  return crypto.randomUUID();
}

/**
 * Handles one mentor turn: entitlement gate, quota, thread resolution, history
 * from DB, generateChat with failover, reply, then best-effort persistence of
 * both turn rows keyed by their Telegram message ids.
 */
export async function handleMentorText(ctx: BotContext, text: string, opts?: MentorTurnOptions): Promise<void> {
  // Instant feedback while settings/model resolve, before the loader message.
  sendTypingIndicator(ctx);

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  // Validate input length
  if ((opts?.userInput ?? text).length > MENTOR_MAX_INPUT_LENGTH) {
    await ctx.reply(t("mentorInputTooLong", lang, { max: MENTOR_MAX_INPUT_LENGTH }));
    return;
  }

  // Authoritative plan gate: /mentor showed the paywall early, but this path is
  // also reachable via reply-continuations, retry taps, and a stale
  // activeMode="mentor" after a downgrade — the check must live on the turn.
  if (!(await ensurePaidFeatureForMessage(ctx, FEATURE_KEYS.mentor, lang))) {
    return;
  }

  // Meter before the paid call (Fable T16): first the per-plan daily mentor cap
  // (the mentor model is dearer than the translate default — Plus is capped, Pro
  // is not), then the shared credit meter.
  const plan = ctx.user.subscriptionPlan;
  if (!(await ensureMentorDailyQuota(ctx, plan, lang))) {
    return;
  }
  const creditCost = await ensureAiQuota(ctx, plan, lang, "mentor");
  if (creditCost === null) {
    return;
  }

  const { model, fallbackModel, maxTokens, systemPrompt } = await resolveMentorSetup(
    ctx.services,
    { id: ctx.user.id, subscriptionPlan: plan },
    settings,
    lang,
  );

  const threadId = await resolveThreadId(ctx, opts);
  const history = await ctx.services.mentorMessageRepository.getRecentMessages(threadId, MAX_MENTOR_HISTORY);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: text },
  ];

  // Show loading indicator
  const loader = await sendLoader(ctx, "mentor", lang, settings?.learningLangs ?? []);

  const stopTimer = mentorDuration.startTimer();
  try {
    const response = await withTimeout(
      ctx.services.ai.generateChat(messages, model, {
        maxTokens,
        userId: ctx.user.id,
        budgetMs: LONG_OP_TIMEOUT_MS,
        failover: buildAiFailover(LONG_OP_TIMEOUT_MS, fallbackModel),
      }),
      LONG_OP_TIMEOUT_MS,
    );

    stopTimer();
    mentorCounter.inc({ status: "success" });

    // Bill the successful call against the shared credit ledger (T16).
    await recordAiUsage(ctx, "mentor", creditCost);

    // `update_id` rather than the ledger row id: `recordAiUsage` returns void, and
    // threading an id out of it would tie the motivation layer to the quota utility
    // (§3.8). A replayed update carries the same id, which is the idempotency needed.
    void recordEffort(ctx, {
      userId: ctx.user.id,
      kind: "mentor_turn",
      dedupeKey: `mentor_turn:${ctx.update.update_id}`,
    });

    // Delete loading indicator (ignore errors if already deleted)
    await dismissLoader(ctx, loader);

    // Plain ctx.reply on purpose: mentor answers are content, and the technical
    // cleanup sweep must never delete a message a reply-continuation can anchor to.
    // The exit button rides only on answers delivered IN mentor mode — a
    // reply-continuation answered from translate mode has no mode to exit.
    const extra = {
      ...(ctx.session.activeMode === "mentor" ? { reply_markup: mentorAnswerKeyboard(lang) } : {}),
    };
    // The prompt asks for Telegram HTML (<b>/<i>); a model that slips invalid
    // markup would turn the whole send into a 400, so fall back to plain text —
    // a raw tag on screen beats a lost answer.
    const sent = await ctx.reply(response, { ...extra, parse_mode: "HTML" }).catch(() => ctx.reply(response, extra));

    // Best-effort persistence: the answer is already delivered, so a DB hiccup
    // only costs this turn its reply-anchor — never a user-facing error.
    try {
      const chatId = ctx.chat!.id;
      const base = { userId: ctx.user.id, chatId, threadId, interfaceLang: lang };
      const userMessageId = opts?.userMessageId ?? ctx.message?.message_id;
      if (userMessageId !== undefined) {
        await ctx.services.mentorMessageRepository.record({
          ...base,
          role: "user",
          content: text,
          telegramMessageId: userMessageId,
        });
      }
      await ctx.services.mentorMessageRepository.record({
        ...base,
        role: "assistant",
        content: response,
        telegramMessageId: sent.message_id,
      });
    } catch (err) {
      logger.error({ err, userId: ctx.user.id, threadId }, "Failed to persist mentor turn");
    }

    // Pin the current thread only in mentor mode: a reply-continuation fired
    // from translate mode must not hijack the next plain mentor message.
    if (ctx.session.activeMode === "mentor") {
      markMentorActivity(ctx.session, threadId);
    }
  } catch (err) {
    stopTimer();
    mentorCounter.inc({ status: "error" });
    logger.error({ err, userId: ctx.user.id, textLength: text.length }, "Mentor chat failed");

    // Delete loading indicator and show error
    await dismissLoader(ctx, loader);

    // Transient timeout → offer a one-tap retry of the same turn (the message is
    // not persisted yet, so re-running it cannot duplicate the turn).
    // A hard failure gets the plain error.
    if (isUserFacingTimeout(err)) {
      await replyWithRetry(ctx, t("loadingTimeout", lang), lang, {
        kind: "mentor",
        text,
        threadId,
        userMessageId: opts?.userMessageId,
        userInput: opts?.userInput,
      });
      return;
    }
    await ctx.reply(t("mentorError", lang));
  } finally {
    loader.stop();
  }
}
