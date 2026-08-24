/**
 * Translation clarification callbacks (Fable T22/B2 slice (e)) — the response
 * side of the clarification flow. When the pipeline (see `translate-flow.ts`)
 * asks the user to disambiguate a source language / meaning / typo, these
 * handlers process the choice: they resolve the direction and re-run the
 * translation via `handleMistypeConfirmCallback`, capture free-form context
 * text, and drive the post-translation "Clarify" button on a rendered card.
 */
import {
  FEATURE_KEYS,
  isSupported,
  isSupportedLanguage,
  logger,
  resolveOutputConfig,
  resolveTemplate,
  type SupportedLang,
  t,
  translateWithContext,
} from "@polyglot/core";
import { inputCorrectionCounter, unrecognizedWordCounter } from "../../metrics.js";
import {
  buildTranslationKeyboard,
  renderSentenceTranslation,
  renderTranslation,
} from "../../renderers/translation.renderer.js";
import type { BotContext } from "../../types.js";
import { resolveDefaultAIModel } from "../../utils/ai-model.js";
import { resolveLanguageOrder } from "../../utils/language-order.js";
import { LONG_OP_TIMEOUT_MS, startTypingKeepalive, withTimeout } from "../../utils/long-op.js";
import { ensurePaidFeature, resolveLockedFeatures } from "./paid-feature.helper.js";
import { handleMistypeConfirmCallback } from "./translate-flow.js";
import {
  clearPendingClarification,
  getUserLanguageGroup,
  isEtymologyEligible,
  normalizeLearningLangs,
  resolvePronounceLangs,
  showAddLanguagePrompt,
} from "./translate-mode.shared.js";
import { setTranslationEntry } from "./translation-map.helper.js";

function resolveTargetsForClarifiedSource(
  selectedSource: string,
  nativeLang: string,
  learningLangs: readonly string[],
  fallbackTargetLangs: readonly string[],
): string[] {
  const userLangs = getUserLanguageGroup(nativeLang, learningLangs);
  const targets = userLangs.filter((code) => code !== selectedSource);
  return targets.length > 0 ? targets : [...fallbackTargetLangs];
}

async function runClarifiedTranslation(
  ctx: BotContext,
  pending: NonNullable<BotContext["session"]["pendingClarification"]>,
  sourceLang: string,
  targetLangs: string[],
  contextHint?: string,
  wordOverride?: string,
): Promise<void> {
  clearPendingClarification(ctx);
  ctx.session.pendingDetectedLang = undefined;
  ctx.session.pendingWord = wordOverride ?? pending.word;
  ctx.session.pendingContextHint = contextHint;
  ctx.session.pendingDirection = { sourceLang, targetLangs };
  await handleMistypeConfirmCallback(ctx);
}

/**
 * Handles "Clarify" callback (tr:clarifypost:{msgId}).
 * Prompts user to enter context, then retranslates with that context.
 */
export async function handleClarifyPostCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const msgId = parseInt(data.split(":")[2] ?? "0", 10);
  const entry = ctx.session.translationMap?.[String(msgId)];

  if (!entry) {
    await ctx.answerCallbackQuery({
      text: "⚠️ Session expired. Please translate the word again.",
      show_alert: true,
    });
    return;
  }

  // Paid feature: a Free user's tap becomes the upgrade screen, never a prompt
  // for context that would then be ignored.
  if (!(await ensurePaidFeature(ctx, FEATURE_KEYS.clarification))) {
    return;
  }

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  ctx.session.awaitingTranslationClarificationContext = true;
  ctx.session.pendingPostTranslationClarifyMsgId = msgId;

  await ctx.reply(t("clarifyTranslationPrompt", lang));
  await ctx.answerCallbackQuery();
}

/**
 * Handles translation clarification callbacks.
 */
export async function handleTranslationClarificationCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const pending = ctx.session.pendingClarification;
  if (!data || !pending) {
    clearPendingClarification(ctx);
    await ctx.answerCallbackQuery({
      text: "⚠️ Session expired. Please translate the word again.",
      show_alert: true,
    });
    return;
  }

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";
  const learningLangs = normalizeLearningLangs(nativeLang, settings?.learningLangs ?? []);

  if (data === "tr:clarify:cancel") {
    clearPendingClarification(ctx);
    await ctx.answerCallbackQuery();
    await ctx.reply(t("translateModeHint", lang));
    return;
  }

  if (data === "tr:clarify:context") {
    ctx.session.awaitingTranslationClarificationContext = true;
    await ctx.answerCallbackQuery();
    await ctx.reply(t("translationClarifyContextPrompt", lang));
    return;
  }

  if (data.startsWith("tr:clarify:lang:")) {
    const selectedSource = data.replace("tr:clarify:lang:", "");
    // Out-of-set source (supported but not studied) → add-and-translate, not a silent translation.
    if (
      !getUserLanguageGroup(nativeLang, learningLangs).includes(selectedSource) &&
      isSupportedLanguage(selectedSource)
    ) {
      await ctx.answerCallbackQuery();
      await showAddLanguagePrompt(ctx, lang, selectedSource, pending.word, pending.contextHint);
      return;
    }
    const targetLangs = resolveTargetsForClarifiedSource(
      selectedSource,
      nativeLang,
      learningLangs,
      pending.targetLangs,
    );
    await ctx.answerCallbackQuery();
    await runClarifiedTranslation(ctx, pending, selectedSource, targetLangs, pending.contextHint);
    return;
  }

  if (data.startsWith("tr:clarify:option:")) {
    const index = Number.parseInt(data.replace("tr:clarify:option:", ""), 10);
    const option = pending.options?.[index];
    if (!option) {
      await ctx.answerCallbackQuery({
        text: "⚠️ Session expired. Please translate the word again.",
        show_alert: true,
      });
      return;
    }
    if (option.kind === "source_language" && option.langCode) {
      // Out-of-set source (supported but not studied) → add-and-translate, not a silent translation.
      if (
        !getUserLanguageGroup(nativeLang, learningLangs).includes(option.langCode) &&
        isSupportedLanguage(option.langCode)
      ) {
        await ctx.answerCallbackQuery();
        await showAddLanguagePrompt(ctx, lang, option.langCode, pending.word, pending.contextHint);
        return;
      }
      const targetLangs = resolveTargetsForClarifiedSource(
        option.langCode,
        nativeLang,
        learningLangs,
        pending.targetLangs,
      );
      await ctx.answerCallbackQuery();
      await runClarifiedTranslation(ctx, pending, option.langCode, targetLangs, pending.contextHint);
      return;
    }
    if (option.kind === "typo_correction" && option.correctedText) {
      const sourceLang = option.langCode ?? pending.sourceLang;
      const targetLangs =
        option.langCode !== undefined
          ? resolveTargetsForClarifiedSource(option.langCode, nativeLang, learningLangs, pending.targetLangs)
          : pending.targetLangs;
      inputCorrectionCounter.inc({ outcome: "confirmed", input_type: pending.inputType });
      await ctx.answerCallbackQuery();
      await runClarifiedTranslation(ctx, pending, sourceLang, targetLangs, pending.contextHint, option.correctedText);
      return;
    }
    if (option.kind === "translate_as_written") {
      inputCorrectionCounter.inc({ outcome: "translate_as_written", input_type: pending.inputType });
      if (pending.reason === "unrecognized_word") {
        unrecognizedWordCounter.inc({ outcome: "translated_as_written" });
      }
      await ctx.answerCallbackQuery();
      await runClarifiedTranslation(ctx, pending, pending.sourceLang, pending.targetLangs, pending.contextHint);
      return;
    }
    const optionLabel = option.label ?? option.value;
    const contextHint = pending.contextHint
      ? `${pending.contextHint}; ${optionLabel}: ${option.value}`
      : `${optionLabel}: ${option.value}`;
    await ctx.answerCallbackQuery();
    await runClarifiedTranslation(ctx, pending, pending.sourceLang, pending.targetLangs, contextHint);
    return;
  }

  await ctx.answerCallbackQuery();
}

/**
 * Captures the next text message as clarification context and retries translation.
 */
export async function handleTranslationClarificationContextText(ctx: BotContext, text: string): Promise<void> {
  // Post-translation clarify flow (from "Уточнить" button on rendered card)
  const postClarifyMsgId = ctx.session.pendingPostTranslationClarifyMsgId;
  if (postClarifyMsgId != null) {
    ctx.session.awaitingTranslationClarificationContext = undefined;
    ctx.session.pendingPostTranslationClarifyMsgId = undefined;

    const entry = ctx.session.translationMap?.[String(postClarifyMsgId)];
    if (!entry) {
      const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
      const iLang = settings?.interfaceLang ?? "en";
      const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
      await ctx.reply(t("translationError", lang));
      return;
    }

    const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
    const iLang = settings?.interfaceLang ?? "en";
    const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
    const nativeLang = settings?.nativeLang ?? "en";

    // Replace context (not accumulate)
    entry.contextHint = text.trim();

    try {
      const model = await resolveDefaultAIModel(ctx.services?.settings, ctx.user.subscriptionPlan);
      const isSentence = entry.inputType === "sentence";
      const targetLangs = Object.keys(entry.output.translations);

      const savedTpl = await ctx.services.translationTemplateRepository.getByUserId(ctx.user.id);
      const userTpl = savedTpl ? { name: savedTpl.name, fields: savedTpl.fields } : null;
      const outputConfig = resolveOutputConfig(
        userTpl,
        isSentence ? "sentence" : (entry.inputType ?? "word"),
        entry.output.original.length,
      );
      const effectiveTemplate = resolveTemplate(userTpl);

      const lookupContextFn = isSentence ? async () => [] : ctx.services.contextLookup;

      // Bound the synchronous re-translation and hold "typing…" open — this
      // callback path has no loader message of its own.
      const stopTyping = startTypingKeepalive(ctx);
      const decision = await withTimeout(
        translateWithContext(
          {
            word: entry.output.original,
            sourceLang: entry.output.sourceLang,
            targetLangs,
            nativeLang,
            model,
            topic: entry.contextHint,
            userId: ctx.user.id,
            outputConfig,
            inputType: entry.inputType,
            // This is a re-run behind a callback — the input was already
            // validated on the first translation. Mark it so the pipeline caps
            // the repair budget and skips the extra judge cycle (isClarifyRerun).
            correctionPolicy: { skipInputCorrection: true },
          },
          {
            lookupContext: lookupContextFn,
            generateObjectFn: ctx.services.ai.generateObject,
          },
        ),
        LONG_OP_TIMEOUT_MS,
      ).finally(stopTyping);

      if (decision.status === "needs_clarification") {
        throw new Error("Unexpected needs_clarification in post-translation clarify flow");
      }

      const order = await resolveLanguageOrder(ctx);
      const cardText = isSentence
        ? `${t("sentenceTranslation", lang)}\n\n${renderSentenceTranslation(decision.output, order, lang, nativeLang)}`
        : renderTranslation(decision.output, order, lang, effectiveTemplate.fields, nativeLang);

      const showGrammarButton =
        entry.inputType !== "word" && (isSentence || !effectiveTemplate.fields.grammarBreakdown);
      const showEtymologyButton = isEtymologyEligible(entry.inputType, decision.output.sourceLang, nativeLang);

      // Append-not-edit: the clarified translation is a NEW card; the previous
      // card stays put as a snapshot (which also avoids Telegram's 48h edit
      // limit). Preserve any accumulated "Other meaning" history for the new
      // card and advance the pending-card pointers to it.
      const pronounceLangs = await resolvePronounceLangs(ctx, decision.output, entry.inputType, order);

      const newMsg = await ctx.reply(cardText, { parse_mode: "HTML" });
      const keyboard = buildTranslationKeyboard({
        interfaceLang: lang,
        msgId: newMsg.message_id,
        showGrammarButton,
        showEtymologyButton,
        pronounceLangs,
        locked: await resolveLockedFeatures(ctx),
      });
      await ctx.api.editMessageReplyMarkup(ctx.chat!.id, newMsg.message_id, { reply_markup: keyboard });

      setTranslationEntry(ctx.session, newMsg.message_id, {
        output: decision.output,
        inputType: entry.inputType,
        contextHint: entry.contextHint,
        previousTranslations: entry.previousTranslations,
      });
      ctx.session.pendingCardMsgId = newMsg.message_id;
      ctx.session.pendingTranslation = decision.output;
    } catch (err) {
      logger.error({ err, word: entry.output.original }, "Post-translation clarify failed");
    }
    return;
  }

  // Pre-translation clarify flow (original ambiguity resolution)
  const pending = ctx.session.pendingClarification;
  if (!pending) {
    clearPendingClarification(ctx);
    const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
    const iLang = settings?.interfaceLang ?? "en";
    const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
    await ctx.reply(t("translationError", lang));
    return;
  }

  const contextHint = pending.contextHint ? `${pending.contextHint}; ${text.trim()}` : text.trim();
  await runClarifiedTranslation(ctx, pending, pending.sourceLang, pending.targetLangs, contextHint);
}
