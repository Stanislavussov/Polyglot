/**
 * Translation card actions (Fable T22/B2 slice (e)) — the callback handlers for
 * the buttons on a rendered translation card: Save, the deprecated Skip/Regen,
 * "Other meaning", grammar breakdown / detail / language-select, and etymology.
 * Each re-renders or extends the card in place.
 */
import {
  errorFields,
  FEATURE_KEYS,
  generateEtymology,
  generateGrammarBreakdown,
  generateGrammarDetail,
  getLangFlag,
  isSupported,
  logEvent,
  orderLangCodes,
  resolveOutputConfig,
  resolveTemplate,
  type SupportedLang,
  type TranslateOutput,
  t,
  translateWithContext,
} from "@polyglot/core";
import { recordEffort } from "../../momentum/momentum.wiring.js";
import {
  buildGrammarLangKeyboard,
  buildTranslationKeyboard,
  renderSentenceTranslation,
  renderTranslation,
} from "../../renderers/translation.renderer.js";
import type { BotContext } from "../../types.js";
import { resolveDefaultAIModel } from "../../utils/ai-model.js";
import { languageOrderFromSettings, resolveLanguageOrder } from "../../utils/language-order.js";
import { isUserFacingTimeout, LONG_OP_TIMEOUT_MS, loadingKeyboard, withTimeout } from "../../utils/long-op.js";
import { toVocabularyInput } from "../../utils/vocabulary-mapper.js";
import { editMessageReplyMarkupOrIgnore, editMessageTextOrReply } from "./edit-message.helper.js";
import { ensurePaidFeature, resolveLockedFeatures } from "./paid-feature.helper.js";
import { answerStaleCallback } from "./stale-callback.helper.js";
import { isEtymologyEligible, resolvePronounceLangs } from "./translate-mode.shared.js";
import { setTranslationEntry } from "./translation-map.helper.js";

/**
 * Handles Save callback in translate mode — full FEAT-30 flow.
 * FK resolution → duplicate detection → sanitize → persist → edit card.
 */
export async function handleSaveCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const msgId = parseInt(data.split(":")[2] ?? "0", 10);
  const entry = ctx.session.translationMap?.[String(msgId)];

  if (!entry) {
    await answerStaleCallback(ctx, { action: "tr:save", msgId });
    return;
  }

  const output = entry.output;
  const inputType = entry.inputType;

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";

  // Step 2 — FK resolution
  const sourceLangEntry = ctx.services.languageCache.getLang(output.sourceLang);
  if (!sourceLangEntry) {
    logEvent(
      "vocabulary.save_failed",
      { reason: "source_language_not_cached", sourceLang: output.sourceLang },
      "error",
    );
    await ctx.answerCallbackQuery({ text: t("translationError", lang) });
    return;
  }
  const sourceLangId = sourceLangEntry.id;

  // Step 3 — Duplicate detection
  const existing = await ctx.services.vocabularyRepository.findByOriginalAndSource(
    ctx.user.id,
    output.original,
    sourceLangId,
  );
  if (existing) {
    const belongsToDefault = await ctx.services.vocabularyDictionaryRepository.entryBelongsToDefault(
      ctx.user.id,
      existing.id,
    );
    if (belongsToDefault) {
      await ctx.answerCallbackQuery({
        text: t("alreadySaved", lang),
        show_alert: true,
      });
      return;
    }

    await ctx.services.vocabularyDictionaryRepository.addEntryToDefault(ctx.user.id, existing.id);
    entry.savedWordId = existing.id;
    logEvent("vocabulary.saved", {
      entryId: existing.id,
      word: output.original,
      sourceLang: output.sourceLang,
      inputType,
      outcome: "relinked_existing",
    });
    // Re-linking is a save too, and `save:<entryId>` is what keeps a word the user
    // already banked from being credited twice (§3.8).
    // Awaited, not fired and forgotten: nothing rendered here depends on it, but the
    // save is the last thing this handler does and the credit must not outlive it.
    await recordEffort(ctx, {
      userId: ctx.user.id,
      kind: "save",
      dedupeKey: `save:${existing.id}`,
    });
    await showSavedCard(ctx, output, lang, nativeLang, inputType);
    await ctx.answerCallbackQuery();
    return;
  }

  // Step 4 — Map to normalized vocabulary input
  const vocabInput = toVocabularyInput(
    output,
    sourceLangId,
    (inputType as "word" | "phrase" | "sentence") ?? "word",
    (code) => ctx.services.languageCache.getLang(code)?.id ?? null,
  );

  // Step 5 — Persist
  const newEntry = await ctx.services.vocabularyRepository.create(ctx.user.id, vocabInput);
  await ctx.services.vocabularyDictionaryRepository.addEntryToDefault(ctx.user.id, newEntry.id);
  logEvent("vocabulary.saved", {
    entryId: newEntry.id,
    word: output.original,
    sourceLang: output.sourceLang,
    targetLangs: Object.keys(output.translations),
    inputType,
    outcome: "created",
  });
  await recordEffort(ctx, {
    userId: ctx.user.id,
    kind: "save",
    dedupeKey: `save:${newEntry.id}`,
  });

  // Step 6 — Update this entry in the map
  entry.savedWordId = newEntry.id;

  await showSavedCard(ctx, output, lang, nativeLang, inputType);
  await ctx.answerCallbackQuery();
}

async function showSavedCard(
  ctx: BotContext,
  output: TranslateOutput,
  lang: SupportedLang,
  nativeLang: string,
  inputType?: string,
): Promise<void> {
  const savedTemplate = await ctx.services.translationTemplateRepository.getByUserId(ctx.user.id);
  const userTpl = savedTemplate ? { name: savedTemplate.name, fields: savedTemplate.fields } : null;
  const effectiveTemplate = resolveTemplate(userTpl);

  const order = await resolveLanguageOrder(ctx);
  const isSentence = inputType === "sentence";
  const cardText = isSentence
    ? `${t("sentenceTranslation", lang)}\n\n${renderSentenceTranslation(output, order, lang, nativeLang)}`
    : renderTranslation(output, order, lang, effectiveTemplate.fields, nativeLang);
  const savedCard = `${cardText}\n\n${t("savedToDict", lang)}`;
  await editMessageTextOrReply(ctx, savedCard, {
    parse_mode: "HTML",
  });
}

/** @deprecated Kept for old messages with skip buttons. */
export async function handleSkipCallback(ctx: BotContext): Promise<void> {
  logEvent("vocabulary.save_skipped", {});
  await ctx.answerCallbackQuery();
}

/** @deprecated Kept for old messages with per-language regen buttons. */
export async function handleRegenCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
}

/**
 * Swap the card's keyboard for the inert loading button while an on-demand
 * section generates. Best-effort: the operation proceeds even if the swap fails.
 */
async function showCardLoading(ctx: BotContext, lang: SupportedLang): Promise<void> {
  await editMessageReplyMarkupOrIgnore(ctx, { reply_markup: loadingKeyboard(lang) });
}

function longOpFailureText(err: unknown, lang: SupportedLang): string {
  return isUserFacingTimeout(err) ? t("loadingTimeout", lang) : t("translationError", lang);
}

/**
 * Handles "Other meaning" callback (tr:altmeaning:{msgId}).
 * Retranslates all languages with negative constraints to avoid repeating previous translations.
 */
export async function handleAltMeaningCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const msgId = parseInt(data.split(":")[2] ?? "0", 10);
  const entry = ctx.session.translationMap?.[String(msgId)];

  if (!entry) {
    await answerStaleCallback(ctx, { action: "tr:altmeaning", msgId });
    return;
  }

  // Paid feature: "Other meaning" is a second full AI pass, so the gate comes
  // before any work — and before the loading message a Free user would see flash.
  if (!(await ensurePaidFeature(ctx, FEATURE_KEYS.clarification))) {
    return;
  }

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";

  // Accumulate negative constraints
  const prev = entry.previousTranslations ?? {};
  for (const [langCode, translation] of Object.entries(entry.output.translations)) {
    prev[langCode] = prev[langCode] ?? [];
    prev[langCode].push(translation.text);
  }
  entry.previousTranslations = prev;

  // Feedback without touching the previous card: a transient loading message,
  // removed once the new card is ready. The previous card is left untouched as a
  // snapshot (append-not-edit) — which also sidesteps Telegram's 48h edit limit.
  const loadingMsg = await ctx.reply(t("regeneratingAll", lang));
  const clearLoading = (): Promise<void> =>
    ctx.api.deleteMessage(ctx.chat!.id, loadingMsg.message_id).then(
      () => {},
      () => {},
    );

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
          negativeConstraints: prev,
        },
        {
          lookupContext: lookupContextFn,
          generateObjectFn: ctx.services.ai.generateObject,
        },
      ),
      LONG_OP_TIMEOUT_MS,
    );

    await clearLoading();

    // "Other meaning" is a best-effort extra: if the pipeline now wants
    // clarification (no genuinely different sense to offer), leave the previous
    // card untouched and just tell the user there are no more meanings.
    if (decision.status === "needs_clarification") {
      await ctx.answerCallbackQuery({ text: t("translationNoMoreMeanings", lang), show_alert: true });
      return;
    }

    const order = await resolveLanguageOrder(ctx);
    const cardText = isSentence
      ? `${t("sentenceTranslation", lang)}\n\n${renderSentenceTranslation(decision.output, order, lang, nativeLang)}`
      : renderTranslation(decision.output, order, lang, effectiveTemplate.fields, nativeLang);

    const showGrammarButton = entry.inputType !== "word" && (isSentence || !effectiveTemplate.fields.grammarBreakdown);
    const showEtymologyButton = isEtymologyEligible(entry.inputType, decision.output.sourceLang, nativeLang);

    // Append-not-edit: the new meaning is a NEW card; the previous one stays put
    // as a snapshot. Carry the accumulated negative constraints forward into the
    // new card's entry so a further "Other meaning" tap still excludes every
    // sense shown so far, and point the pending-card pointers at the new card.
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
      previousTranslations: prev,
    });
    ctx.session.pendingCardMsgId = newMsg.message_id;
    ctx.session.pendingTranslation = decision.output;
  } catch (err) {
    await clearLoading();
    logEvent("card.alt_meaning_failed", { word: entry.output.original, ...errorFields(err) }, "error");
    // The previous card is untouched; a timeout is worth surfacing as such, any
    // other failure on this secondary action reads better as "no more meanings".
    const alertText = isUserFacingTimeout(err) ? t("loadingTimeout", lang) : t("translationNoMoreMeanings", lang);
    await ctx.answerCallbackQuery({ text: alertText, show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery();
}

/**
 * Handles grammar breakdown callback (tr:grammar:{msgId}).
 * Generates on-demand grammar analysis for translations.
 */
export async function handleGrammarBreakdownCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const msgId = parseInt(data.split(":")[2] ?? "0", 10);
  const entry = ctx.session.translationMap?.[String(msgId)];

  if (!entry) {
    await answerStaleCallback(ctx, { action: "tr:grammar", msgId });
    return;
  }

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";

  if (!(await ensurePaidFeature(ctx, FEATURE_KEYS.grammarBreakdown, lang))) {
    return;
  }

  // Use cached if available
  if (entry.grammarBreakdown) {
    await reRenderCard(ctx, entry, msgId, lang, nativeLang);
    await ctx.answerCallbackQuery();
    return;
  }

  await showCardLoading(ctx, lang);

  try {
    const model = await resolveDefaultAIModel(ctx.services?.settings, ctx.user.subscriptionPlan);
    const translations: Record<string, string> = {};
    for (const [code, tr] of Object.entries(entry.output.translations)) {
      translations[code] = tr.text;
    }

    const result = await withTimeout(
      generateGrammarBreakdown(
        {
          originalText: entry.output.original,
          translations,
          sourceLang: entry.output.sourceLang,
          targetLangs: Object.keys(entry.output.translations),
          nativeLang,
          inputType: entry.inputType === "sentence" ? "sentence" : "phrase",
        },
        ctx.services.ai.generateObject,
        model,
        ctx.user.id,
      ),
      LONG_OP_TIMEOUT_MS,
    );

    entry.grammarBreakdown = result;
    await reRenderCard(ctx, entry, msgId, lang, nativeLang);
  } catch (err) {
    logEvent("card.grammar_breakdown_failed", { word: entry.output.original, ...errorFields(err) }, "error");
    try {
      await reRenderCard(ctx, entry, msgId, lang, nativeLang);
    } catch {
      // Card restore is best-effort; the alert below explains the failure.
    }
    await ctx.answerCallbackQuery({ text: longOpFailureText(err, lang), show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery();
}

/**
 * Handles etymology callback (tr:etymology:{msgId}).
 * Generates on-demand etymology for the original term, in the native language.
 */
export async function handleEtymologyCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const msgId = parseInt(data.split(":")[2] ?? "0", 10);
  const entry = ctx.session.translationMap?.[String(msgId)];

  if (!entry) {
    await answerStaleCallback(ctx, { action: "tr:etymology", msgId });
    return;
  }

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";

  if (!(await ensurePaidFeature(ctx, FEATURE_KEYS.etymology, lang))) {
    return;
  }

  // Use cached if available
  if (entry.etymology) {
    await reRenderCard(ctx, entry, msgId, lang, nativeLang);
    await ctx.answerCallbackQuery();
    return;
  }

  await showCardLoading(ctx, lang);

  try {
    const model = await resolveDefaultAIModel(ctx.services?.settings, ctx.user.subscriptionPlan);

    const result = await withTimeout(
      generateEtymology(
        {
          originalText: entry.output.original,
          sourceLang: entry.output.sourceLang,
          nativeLang,
          inputType: entry.inputType === "word" ? "word" : "phrase",
        },
        ctx.services.ai.generateObject,
        model,
        ctx.user.id,
      ),
      LONG_OP_TIMEOUT_MS,
    );

    entry.etymology = result;
    await reRenderCard(ctx, entry, msgId, lang, nativeLang);
  } catch (err) {
    logEvent("card.etymology_failed", { word: entry.output.original, ...errorFields(err) }, "error");
    try {
      await reRenderCard(ctx, entry, msgId, lang, nativeLang);
    } catch {
      // Card restore is best-effort; the alert below explains the failure.
    }
    await ctx.answerCallbackQuery({ text: longOpFailureText(err, lang), show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery();
}

/**
 * Re-render a translation card with whichever on-demand sections have been
 * generated (grammar breakdown and/or etymology), and rebuild the keyboard so
 * each learning-aid button hides once its section is shown.
 */
async function reRenderCard(
  ctx: BotContext,
  entry: NonNullable<BotContext["session"]["translationMap"]>[string],
  msgId: number,
  lang: SupportedLang,
  nativeLang: string,
): Promise<void> {
  const isSentence = entry.inputType === "sentence";
  const savedTpl = await ctx.services.translationTemplateRepository.getByUserId(ctx.user.id);
  const userTpl = savedTpl ? { name: savedTpl.name, fields: savedTpl.fields } : null;
  const effectiveTemplate = resolveTemplate(userTpl);

  const order = await resolveLanguageOrder(ctx);
  const cardText = isSentence
    ? `${t("sentenceTranslation", lang)}\n\n${renderSentenceTranslation(entry.output, order, lang, nativeLang, false, entry.grammarBreakdown)}`
    : renderTranslation(
        entry.output,
        order,
        lang,
        effectiveTemplate.fields,
        nativeLang,
        false,
        entry.grammarBreakdown,
        entry.etymology,
      );

  const grammarShown = !!entry.grammarBreakdown;
  const etymologyShown = !!entry.etymology;
  const grammarEligible = entry.inputType !== "word" && (isSentence || !effectiveTemplate.fields.grammarBreakdown);

  // Grammar button hides once shown (replaced by the Details button for phrases);
  // etymology button hides once its section is on the card.
  const showGrammarButton = grammarEligible && !grammarShown;
  const showGrammarDetailButton = grammarShown && !isSentence;
  const showEtymologyButton =
    isEtymologyEligible(entry.inputType, entry.output.sourceLang, nativeLang) && !etymologyShown;

  const pronounceLangs = await resolvePronounceLangs(ctx, entry.output, entry.inputType, order);

  const keyboard = buildTranslationKeyboard({
    interfaceLang: lang,
    msgId,
    showGrammarButton,
    showGrammarDetailButton,
    showEtymologyButton,
    pronounceLangs,
    locked: await resolveLockedFeatures(ctx),
  });
  await ctx.api.editMessageText(ctx.chat!.id, msgId, cardText, {
    reply_markup: keyboard,
    parse_mode: "HTML",
  });
}

/**
 * Handles grammar detail callback (tr:gramdetail:{msgId}).
 * Shows language selection keyboard for detailed grammar explanation.
 */
export async function handleGrammarDetailCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const msgId = parseInt(data.split(":")[2] ?? "0", 10);
  const entry = ctx.session.translationMap?.[String(msgId)];

  if (!entry?.grammarBreakdown) {
    await answerStaleCallback(ctx, { action: "tr:gramdetail", msgId });
    return;
  }

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  if (!(await ensurePaidFeature(ctx, FEATURE_KEYS.grammarDetail, lang))) {
    return;
  }

  // Show language selection keyboard
  // Keep the empty-breakdown filter: a button for a language with no grammar data
  // would be dead. Order what survives, so the buttons do not reshuffle between
  // taps — the breakdown record comes back from the session alphabetized.
  const langCodes = orderLangCodes(
    Object.keys(entry.grammarBreakdown).filter((code) => entry.grammarBreakdown![code]!.length > 0),
    languageOrderFromSettings(settings),
  );

  const langKeyboard = buildGrammarLangKeyboard(langCodes, lang, msgId);
  await ctx.api.editMessageReplyMarkup(ctx.chat!.id, msgId, { reply_markup: langKeyboard });
  await ctx.answerCallbackQuery();
}

/**
 * Handles grammar language selection callback (tr:gramlang:{langCode}:{msgId}).
 * Generates detailed grammar explanation for the selected language.
 */
export async function handleGrammarLangSelectCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const parts = data.split(":");
  const langCodeOrCancel = parts[2] ?? "";
  const msgId = parseInt(parts[3] ?? "0", 10);

  const entry = ctx.session.translationMap?.[String(msgId)];
  if (!entry) {
    await answerStaleCallback(ctx, { action: "tr:gramlang", msgId });
    return;
  }

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;
  const nativeLang = settings?.nativeLang ?? "en";
  // Every keyboard rebuild below is a restore, so the pronunciation row has to be
  // recomputed too — otherwise the speaker silently disappears once a user opens
  // the grammar-detail flow on a card.
  const detailPronounceLangs = await resolvePronounceLangs(
    ctx,
    entry.output,
    entry.inputType,
    languageOrderFromSettings(settings),
  );
  const locked = await resolveLockedFeatures(ctx);
  /** The card's normal keyboard, with the detail button back — every exit from this flow restores it. */
  const restoreKeyboard = () =>
    buildTranslationKeyboard({
      interfaceLang: lang,
      msgId,
      showGrammarDetailButton: true,
      pronounceLangs: detailPronounceLangs,
      locked,
    });

  // Cancel — restore normal keyboard with detail button
  if (langCodeOrCancel === "cancel") {
    const keyboard = restoreKeyboard();
    await ctx.api.editMessageReplyMarkup(ctx.chat!.id, msgId, { reply_markup: keyboard });
    await ctx.answerCallbackQuery();
    return;
  }

  // Language selected — this is where grammar detail actually spends an AI call,
  // so it carries its own gate rather than trusting the one on `tr:gramdetail`:
  // the language keyboard survives on the card after the flow is abandoned, and a
  // subscription can lapse between opening it and tapping a language. Cancel stays
  // ungated above so a stale keyboard can always be dismissed.
  if (!(await ensurePaidFeature(ctx, FEATURE_KEYS.grammarDetail, lang))) {
    return;
  }

  const langCode = langCodeOrCancel;
  const translation = entry.output.translations[langCode];
  const breakdown = entry.grammarBreakdown?.[langCode];

  if (!translation || !breakdown || breakdown.length === 0) {
    await ctx.answerCallbackQuery({
      text: "⚠️ Grammar data not available for this language.",
      show_alert: true,
    });
    return;
  }

  await showCardLoading(ctx, lang);

  try {
    const model = await resolveDefaultAIModel(ctx.services?.settings, ctx.user.subscriptionPlan);

    const detailText = await withTimeout(
      generateGrammarDetail(
        {
          originalText: entry.output.original,
          translation: translation.text,
          langCode,
          nativeLang,
          grammarBreakdown: breakdown,
        },
        ctx.services.ai.generateText,
        model,
        ctx.user.id,
      ),
      LONG_OP_TIMEOUT_MS,
    );

    // Send as separate message
    const flag = getLangFlag(langCode) ?? "🔤";
    const header = `🔬 <b>${flag} ${langCode.toUpperCase()}: "${escapeHtml(translation.text)}"</b>\n\n`;
    await ctx.reply(header + escapeHtml(detailText), { parse_mode: "HTML" });

    // Restore keyboard with detail button
    const keyboard = restoreKeyboard();
    await ctx.api.editMessageReplyMarkup(ctx.chat!.id, msgId, { reply_markup: keyboard });
  } catch (err) {
    logEvent("card.grammar_detail_failed", { word: entry.output.original, langCode, ...errorFields(err) }, "error");
    const keyboard = restoreKeyboard();
    await ctx.api.editMessageReplyMarkup(ctx.chat!.id, msgId, { reply_markup: keyboard }).catch(() => {});
    await ctx.answerCallbackQuery({ text: longOpFailureText(err, lang), show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery();
}

/** Escape HTML for safe Telegram rendering */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
