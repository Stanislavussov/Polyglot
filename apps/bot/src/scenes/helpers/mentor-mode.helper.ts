/**
 * Mentor mode helper — handles plain text messages when activeMode === "mentor".
 *
 * The user chats with an AI language-learning coach. The coach helps the user
 * translate and learn words through guided conversation — it does NOT translate
 * immediately. Conversation history is kept in session and trimmed to
 * MAX_MENTOR_HISTORY entries to prevent unbounded growth.
 */
import {
  buildMentorSystemPrompt,
  type ChatMessage,
  isSupported,
  logger,
  MAX_MENTOR_HISTORY,
  type SupportedLang,
  t,
} from "@polyglot/core";
import { mentorCounter, mentorDuration } from "../../metrics.js";
import type { BotContext } from "../../types.js";
import { resolveDefaultAIModel } from "../../utils/ai-model.js";
import { ensureAiQuota, recordAiUsage } from "../../utils/ai-quota.js";
import { isUserFacingTimeout, LONG_OP_TIMEOUT_MS, sendTypingIndicator, withTimeout } from "../../utils/long-op.js";

/** Maximum output tokens for mentor responses — keeps replies short. */
const MENTOR_MAX_TOKENS = 300;

/** Maximum input message length in characters. */
const MENTOR_MAX_INPUT_LENGTH = 1000;

/**
 * Handles a plain text message in mentor mode.
 * Builds the system prompt + conversation history, calls generateChat,
 * and replies with the AI's coaching response.
 */
export async function handleMentorText(ctx: BotContext, text: string): Promise<void> {
  // Instant feedback while settings/model resolve, before the loader message.
  sendTypingIndicator(ctx);

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  // Validate input length
  if (text.length > MENTOR_MAX_INPUT_LENGTH) {
    await ctx.reply(t("mentorInputTooLong", lang, { max: MENTOR_MAX_INPUT_LENGTH }));
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

  // Resolve AI model
  const model = await resolveDefaultAIModel(ctx.services.settings, plan);

  // Build system prompt from user's language settings
  const systemPrompt = buildMentorSystemPrompt({
    nativeLang: settings?.nativeLang ?? "en",
    learningLangs: settings?.learningLangs ?? [],
    interfaceLang: lang,
  });

  // Build messages: system prompt + conversation history + current user message
  const history = ctx.session.mentor?.history ?? [];
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
      }),
      LONG_OP_TIMEOUT_MS,
    );

    stopTimer();
    mentorCounter.inc({ status: "success" });

    // Bill the successful call against the shared credit ledger (T16).
    await recordAiUsage(ctx, "mentor", creditCost);

    // Delete loading indicator (ignore errors if already deleted)
    await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});

    // Reply with the AI response
    await ctx.reply(response);

    // Update session history with the new turn, trimmed to MAX_MENTOR_HISTORY
    const newHistory = [
      ...history,
      { role: "user" as const, content: text },
      { role: "assistant" as const, content: response },
    ];
    const trimmed = newHistory.slice(-MAX_MENTOR_HISTORY);
    ctx.session.mentor = { history: trimmed };
  } catch (err) {
    stopTimer();
    mentorCounter.inc({ status: "error" });
    logger.error({ err, userId: ctx.user.id, textLength: text.length }, "Mentor chat failed");

    // Delete loading indicator and show error
    await ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});
    await ctx.reply(isUserFacingTimeout(err) ? t("loadingTimeout", lang) : t("mentorError", lang));
  }
}
