/**
 * Mentor mode helper — handles plain text messages when activeMode === "mentor"
 * and reply-continuations routed in from any mode.
 *
 * The user chats with an AI language assistant about grammar, usage, and idioms.
 * Conversation history lives in `mentor_messages` (DB), windowed to
 * MAX_MENTOR_HISTORY per thread; the session only pins the current thread id.
 */
import {
  buildMentorSystemPrompt,
  type ChatMessage,
  FEATURE_KEYS,
  isSupported,
  logger,
  MAX_MENTOR_HISTORY,
  type SupportedLang,
  t,
} from "@polyglot/core";
import { mentorCounter, mentorDuration } from "../../metrics.js";
import type { BotContext } from "../../types.js";
import { buildAiFailover, resolveDefaultAIModel, resolveFallbackAIModel } from "../../utils/ai-model.js";
import { ensureAiQuota, recordAiUsage } from "../../utils/ai-quota.js";
import { isUserFacingTimeout, LONG_OP_TIMEOUT_MS, sendTypingIndicator, withTimeout } from "../../utils/long-op.js";
import { replyTechnical } from "../../utils/message-cleanup.js";
import { replyWithRetry } from "../../utils/retry-action.js";
import { ensurePaidFeatureForMessage } from "./paid-feature.helper.js";

/** Maximum output tokens for mentor responses — enough for a grammar explanation with examples. */
const MENTOR_MAX_TOKENS = 700;

/** Maximum input message length in characters. */
const MENTOR_MAX_INPUT_LENGTH = 1000;

export interface MentorTurnOptions {
  /** Thread to continue (reply-continuation or retry); resolved from session/DB when absent. */
  threadId?: string;
}

/**
 * Which thread this turn belongs to.
 *
 * `/mentor` writes `session.mentor = {}` (fresh start, no recovery); a session
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
  if (text.length > MENTOR_MAX_INPUT_LENGTH) {
    await replyTechnical(ctx, t("mentorInputTooLong", lang, { max: MENTOR_MAX_INPUT_LENGTH }));
    return;
  }

  // Authoritative plan gate: /mentor showed the paywall early, but this path is
  // also reachable via reply-continuations, retry taps, and a stale
  // activeMode="mentor" after a downgrade — the check must live on the turn.
  if (!(await ensurePaidFeatureForMessage(ctx, FEATURE_KEYS.mentor, lang))) {
    return;
  }

  // Meter credits before the paid call (Fable T16): a mentor turn is a paid AI
  // call like any other, so an exhausted free user is refused here instead of
  // running the coach for free on the owner's key.
  const plan = ctx.user.subscriptionPlan;
  const creditCost = await ensureAiQuota(ctx, plan, lang, "mentor");
  if (creditCost === null) {
    return;
  }

  // Resolve AI model + admin-managed failover split (parity with notifications).
  const [model, fallbackModel] = await Promise.all([
    resolveDefaultAIModel(ctx.services.settings, plan),
    resolveFallbackAIModel(ctx.services.settings),
  ]);

  // Build system prompt from user's language settings
  const systemPrompt = buildMentorSystemPrompt({
    nativeLang: settings?.nativeLang ?? "en",
    learningLangs: settings?.learningLangs ?? [],
    interfaceLang: lang,
  });

  const threadId = await resolveThreadId(ctx, opts);
  const history = await ctx.services.mentorMessageRepository.getRecentMessages(threadId, MAX_MENTOR_HISTORY);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history,
    { role: "user", content: text },
  ];

  // Show loading indicator
  const loadingMsg = await ctx.reply(t("mentorThinking", lang));

  const stopTimer = mentorDuration.startTimer();
  try {
    const response = await withTimeout(
      ctx.services.ai.generateChat(messages, model, {
        maxTokens: MENTOR_MAX_TOKENS,
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

    // Delete loading indicator (ignore errors if already deleted)
    await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});

    // Plain ctx.reply on purpose: mentor answers are content, and the technical
    // cleanup sweep must never delete a message a reply-continuation can anchor to.
    const sent = await ctx.reply(response);

    // Best-effort persistence: the answer is already delivered, so a DB hiccup
    // only costs this turn its reply-anchor — never a user-facing error.
    try {
      const chatId = ctx.chat!.id;
      const base = { userId: ctx.user.id, chatId, threadId, interfaceLang: lang };
      if (ctx.message?.message_id !== undefined) {
        await ctx.services.mentorMessageRepository.record({
          ...base,
          role: "user",
          content: text,
          telegramMessageId: ctx.message.message_id,
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
      ctx.session.mentor = { threadId };
    }
  } catch (err) {
    stopTimer();
    mentorCounter.inc({ status: "error" });
    logger.error({ err, userId: ctx.user.id, textLength: text.length }, "Mentor chat failed");

    // Delete loading indicator and show error
    await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});

    // Transient timeout → offer a one-tap retry of the same turn (the message is
    // not persisted yet, so re-running it cannot duplicate the turn).
    // A hard failure gets the plain error.
    if (isUserFacingTimeout(err)) {
      await replyWithRetry(ctx, t("loadingTimeout", lang), lang, { kind: "mentor", text, threadId });
      return;
    }
    await replyTechnical(ctx, t("mentorError", lang));
  }
}
