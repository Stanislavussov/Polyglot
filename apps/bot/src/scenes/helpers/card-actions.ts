/**
 * Translation card actions (Fable T22/B2 slice (e)) — the callback handlers for
 * the buttons on a rendered translation card: Save, the deprecated Skip/Regen,
 * "Other meaning" and etymology. Each re-renders or extends the card in place.
 */
import {
  errorFields,
  FEATURE_KEYS,
  generateEtymology,
  isSupported,
  logEvent,
  resolveOutputConfig,
  resolveTemplate,
  type SupportedLang,
  t,
  translateWithContext,
} from "@polyglot/core";
import type { InlineKeyboard } from "grammy";
import { recordEffort } from "../../momentum/momentum.wiring.js";
import { renderFlashCardBackScreen } from "../../renderers/flashcard.renderer.js";
import { renderSentenceTranslation, renderTranslation } from "../../renderers/translation.renderer.js";
import type { BotContext } from "../../types.js";
import { resolveDefaultAIModel } from "../../utils/ai-model.js";
import { resolveLanguageOrder } from "../../utils/language-order.js";
import { isUserFacingTimeout, LONG_OP_TIMEOUT_MS, loadingKeyboard, withTimeout } from "../../utils/long-op.js";
import { toVocabularyInput } from "../../utils/vocabulary-mapper.js";
import { buildCardKeyboard } from "./card-keyboard.js";
import { editMessageReplyMarkupOrIgnore, editMessageTextOrReply } from "./edit-message.helper.js";
import { ensurePaidFeature } from "./paid-feature.helper.js";
import { answerStaleCallback } from "./stale-callback.helper.js";
import { setTranslationEntry } from "./translation-map.helper.js";

/** Per-message translation state kept in the session, keyed by the card's message id. */
type TranslationEntry = NonNullable<BotContext["session"]["translationMap"]>[string];

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
      // The word can be in the dictionary while THIS card still offers Save (it was
      // banked from another card or from the dictionary itself). Bring the card to
      // the saved state so the button stops lying, then say so.
      entry.savedWordId = existing.id;
      await showSavedCard(ctx, entry, msgId, lang, nativeLang);
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
    // Re-linking is a save too; `save:<entryId>` is what keeps a word the user already
    // banked from being credited twice (§3.8). Awaited because the save is the last
    // thing this handler does and the credit must not outlive it.
    await recordEffort(ctx, {
      userId: ctx.user.id,
      kind: "save",
      dedupeKey: `save:${existing.id}`,
    });
    await showSavedCard(ctx, entry, msgId, lang, nativeLang);
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

  await showSavedCard(ctx, entry, msgId, lang, nativeLang);
  await ctx.answerCallbackQuery();
}

/**
 * Re-render the card after a save. The keyboard is rebuilt and passed along:
 * `editMessageText` with no `reply_markup` STRIPS the inline keyboard, which is
 * what used to leave a saved card with no buttons and force the user into the
 * dictionary to keep working on the word.
 */
async function showSavedCard(
  ctx: BotContext,
  entry: TranslationEntry,
  msgId: number,
  lang: SupportedLang,
  nativeLang: string,
): Promise<void> {
  const { text, keyboard } = await buildCardView(ctx, entry, msgId, lang, nativeLang);
  await editMessageTextOrReply(ctx, text, { reply_markup: keyboard, parse_mode: "HTML" });
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

    // Append-not-edit: the new meaning is a NEW card; the previous one stays put
    // as a snapshot. Carry the accumulated negative constraints forward into the
    // new card's entry so a further "Other meaning" tap still excludes every
    // sense shown so far, and point the pending-card pointers at the new card.
    const newMsg = await ctx.reply(cardText, { parse_mode: "HTML" });

    setTranslationEntry(ctx.session, newMsg.message_id, {
      output: decision.output,
      inputType: entry.inputType,
      contextHint: entry.contextHint,
      previousTranslations: prev,
      // The tap that produced this card came from an open action list, so the new
      // card opens with the list already open — the user is still in that mode.
      actionsExpanded: entry.actionsExpanded === true,
    });
    const newEntry = ctx.session.translationMap![String(newMsg.message_id)]!;
    const keyboard = await buildCardKeyboard(ctx, newEntry, newMsg.message_id, lang, nativeLang);
    await ctx.api.editMessageReplyMarkup(ctx.chat!.id, newMsg.message_id, { reply_markup: keyboard });

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
 * Card text + keyboard for an entry's CURRENT state: whichever on-demand sections
 * have been generated, and the saved state once the word is in the dictionary.
 *
 * The keyboard comes from {@link buildCardKeyboard}, which is what a fresh card
 * and the `⋯ More` toggle use too — each learning aid retires once its section is
 * on the card, and nothing else about the card's buttons changes just because one
 * of them was tapped. The action list stays open, since a section appearing under
 * a still-open menu is the result the tap promised.
 */
async function buildCardView(
  ctx: BotContext,
  entry: TranslationEntry,
  msgId: number,
  lang: SupportedLang,
  nativeLang: string,
): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const isSentence = entry.inputType === "sentence";
  const savedTpl = await ctx.services.translationTemplateRepository.getByUserId(ctx.user.id);
  const userTpl = savedTpl ? { name: savedTpl.name, fields: savedTpl.fields } : null;
  const effectiveTemplate = resolveTemplate(userTpl);

  const order = await resolveLanguageOrder(ctx);
  const body = isSentence
    ? `${t("sentenceTranslation", lang)}\n\n${renderSentenceTranslation(entry.output, order, lang, nativeLang, false)}`
    : renderTranslation(entry.output, order, lang, effectiveTemplate.fields, nativeLang, false, entry.etymology);

  const keyboard = await buildCardKeyboard(ctx, entry, msgId, lang, nativeLang);
  // A word under review is in the dictionary by definition, so the confirmation
  // tells the reader nothing and lands between the card and the question the
  // ratings answer.
  const isSaved = entry.savedWordId !== undefined && entry.reviewCard === undefined;
  const cardText = isSaved ? `${body}\n\n${t("savedToDict", lang)}` : body;

  // A revealed review card is an ordinary card inside the deck's screen, so a
  // rewrite has to put the chrome back — otherwise the progress line and the
  // question the ratings answer vanish from under the reader mid-review. Applied
  // here for the same reason the deck's buttons are applied in `buildCardKeyboard`:
  // every later rewrite of this message comes through this one function. Without
  // the deck session there are no honest numbers for the progress line, so the
  // card renders bare rather than inventing them.
  const cards = ctx.session.cards;
  const text =
    entry.reviewCard && cards
      ? renderFlashCardBackScreen(cardText, cards.currentIndex + 1, cards.deck.length, lang)
      : cardText;

  return { text, keyboard };
}

/** Redraw a card in place after an on-demand section was generated. */
async function reRenderCard(
  ctx: BotContext,
  entry: TranslationEntry,
  msgId: number,
  lang: SupportedLang,
  nativeLang: string,
): Promise<void> {
  const { text, keyboard } = await buildCardView(ctx, entry, msgId, lang, nativeLang);
  await ctx.api.editMessageText(ctx.chat!.id, msgId, text, {
    reply_markup: keyboard,
    parse_mode: "HTML",
  });
}
