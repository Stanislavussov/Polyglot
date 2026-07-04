/**
 * Dictionary callback handlers — dict:* callbacks for dictionary browsing.
 */

import {
  getAllLangs,
  userRepository,
  vocabularyDictionaryRepository,
  vocabularyRepository,
} from "@polyglot/adapter-db";
import type { SupportedLang, VocabularyDictionaryWithCount } from "@polyglot/core";
import { isSupported, logger, resolveOutputConfig, resolveTemplate, t, translate } from "@polyglot/core";
import {
  buildDeleteConfirmKeyboard,
  buildDictionaryChoiceKeyboard,
  buildDictionaryDeleteConfirmKeyboard,
  buildDictionaryEntryKeyboard,
  buildDictionaryListKeyboard,
  buildDictionaryNamePromptKeyboard,
  buildDictionarySwitcherKeyboard,
  DICTIONARY_PAGE_SIZE,
  renderDictionaryEntry,
  renderDictionaryList,
  renderDictionarySwitcher,
} from "../../renderers/dictionary.renderer.js";
import { renderTranslation } from "../../renderers/translation.renderer.js";
import type { BotContext } from "../../types.js";
import { isUserFacingTimeout, LONG_OP_TIMEOUT_MS, withTimeout } from "../../utils/long-op.js";
import { cleanupTechnicalMessages } from "../../utils/message-cleanup.js";

const MAX_DICTIONARY_NAME_LENGTH = 32;

function getLangCodeById(id: number): string | undefined {
  const all = getAllLangs();
  return all.find((l) => l.id === id)?.code;
}

async function resolveNativeLangId(ctx: BotContext): Promise<number | undefined> {
  const settings = await userRepository.getSettings(ctx.user.id);
  const nativeLangCode = settings?.nativeLang;
  if (!nativeLangCode) return undefined;
  const found = getAllLangs().find((l) => l.code === nativeLangCode);
  return found?.id;
}

async function getUserLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await userRepository.getSettings(ctx.user.id);
  const lang = settings?.interfaceLang;

  return lang && isSupported(lang) ? lang : "en";
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) || parsed < 1 ? null : parsed;
}

async function answerNoResults(ctx: BotContext): Promise<void> {
  const lang = await getUserLang(ctx);
  await ctx.answerCallbackQuery({ text: t("noResults", lang) });
}

async function getOwnedEntry(ctx: BotContext, entryId: number) {
  const entry = await vocabularyRepository.findById(entryId);
  if (!entry || entry.userId !== ctx.user.id || !entry.isActive) return null;
  return entry;
}

async function getOwnedDictionary(ctx: BotContext, dictionaryId: number) {
  return vocabularyDictionaryRepository.findOwnedById(ctx.user.id, dictionaryId);
}

async function showDictionaryList(ctx: BotContext, dictionaryId: number, page: number): Promise<void> {
  const lang = await getUserLang(ctx);
  const dictionary = await getOwnedDictionary(ctx, dictionaryId);
  if (!dictionary) {
    await answerNoResults(ctx);
    return;
  }

  const total = await vocabularyRepository.countByUser(ctx.user.id, dictionary.id);
  const totalPages = Math.max(1, Math.ceil(total / DICTIONARY_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const offset = (safePage - 1) * DICTIONARY_PAGE_SIZE;
  const entries = await vocabularyRepository.findByUserPaginated(
    ctx.user.id,
    offset,
    DICTIONARY_PAGE_SIZE,
    dictionary.id,
  );

  const text = renderDictionaryList(entries, safePage, totalPages, total, lang, dictionary.name);
  const kb = buildDictionaryListKeyboard(entries, safePage, totalPages, lang, dictionary.id);

  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
  } catch (err) {
    logger.error({ err }, "Failed to edit dictionary message");
  }

  ctx.session.dictionary = { ...(ctx.session.dictionary ?? {}), currentPage: safePage, dictionaryId: dictionary.id };
}

async function showSwitcher(ctx: BotContext): Promise<void> {
  const lang = await getUserLang(ctx);
  const dictionaries = await vocabularyDictionaryRepository.listByUser(ctx.user.id);
  const text = renderDictionarySwitcher(dictionaries, lang);
  const kb = buildDictionarySwitcherKeyboard(dictionaries, lang);

  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
  } catch (err) {
    logger.error({ err }, "Failed to edit dictionary switcher");
  }
}

function validateDictionaryName(
  name: string,
  dictionaries: VocabularyDictionaryWithCount[],
  currentDictionaryId?: number,
): string | null {
  const normalized = vocabularyDictionaryRepository.normalizeName(name);
  if (normalized.length === 0) return null;
  if (normalized.length > MAX_DICTIONARY_NAME_LENGTH) return null;
  const lower = normalized.toLowerCase();
  const duplicate = dictionaries.some(
    (dictionary) => dictionary.id !== currentDictionaryId && dictionary.name.toLowerCase() === lower,
  );
  return duplicate ? null : normalized;
}

export async function handleDictionaryNameInput(ctx: BotContext): Promise<void> {
  const wizard = ctx.session.dictionaryWizard;
  const text = ctx.message?.text;
  if (!wizard || !text) return;

  const lang = await getUserLang(ctx);
  const dictionaries = await vocabularyDictionaryRepository.listByUser(ctx.user.id);
  const name = validateDictionaryName(text, dictionaries, wizard.dictionaryId);

  if (!name) {
    await ctx.reply(t("dictionaryNameInvalid", lang, { max: MAX_DICTIONARY_NAME_LENGTH }));
    return;
  }

  if (wizard.action === "create") {
    const dictionary = await vocabularyDictionaryRepository.create(ctx.user.id, name);
    ctx.session.dictionaryWizard = undefined;
    await ctx.reply(t("dictionaryCreated", lang, { name: dictionary.name }));
    await showDictionaryList(ctx, dictionary.id, 1);
    return;
  }

  if (!wizard.dictionaryId) {
    ctx.session.dictionaryWizard = undefined;
    await ctx.reply(t("dictionarySessionExpired", lang));
    return;
  }

  const renamed = await vocabularyDictionaryRepository.rename(ctx.user.id, wizard.dictionaryId, name);
  ctx.session.dictionaryWizard = undefined;
  if (!renamed) {
    await ctx.reply(t("dictionarySessionExpired", lang));
    return;
  }

  await ctx.reply(t("dictionaryRenamed", lang, { name: renamed.name }));
  await showDictionaryList(ctx, renamed.id, ctx.session.dictionary?.currentPage ?? 1);
}

export async function handleDictPage(ctx: BotContext): Promise<void> {
  const parts = (ctx.callbackQuery?.data ?? "").split(":");
  const dictionaryId = parsePositiveInteger(parts[2]) ?? ctx.session.dictionary?.dictionaryId;
  const page = parsePositiveInteger(parts[3]);
  if (!dictionaryId || !page) return void ctx.answerCallbackQuery();

  await showDictionaryList(ctx, dictionaryId, page);
  await ctx.answerCallbackQuery();
}

export async function handleDictView(ctx: BotContext): Promise<void> {
  const parts = (ctx.callbackQuery?.data ?? "").split(":");
  const dictionaryId = parsePositiveInteger(parts[2]) ?? ctx.session.dictionary?.dictionaryId;
  const entryId = parsePositiveInteger(parts[3]);
  const page = parsePositiveInteger(parts[4]) ?? ctx.session.dictionary?.currentPage ?? 1;

  if (!dictionaryId || !entryId) {
    await answerNoResults(ctx);
    return;
  }

  const lang = await getUserLang(ctx);
  const [entry, dictionary] = await Promise.all([getOwnedEntry(ctx, entryId), getOwnedDictionary(ctx, dictionaryId)]);
  if (!entry || !dictionary) {
    await ctx.answerCallbackQuery({ text: t("noResults", lang) });
    return;
  }

  const belongs = await vocabularyDictionaryRepository.entryBelongsToDictionary(entryId, dictionaryId);
  if (!belongs) {
    await ctx.answerCallbackQuery({ text: t("noResults", lang) });
    return;
  }

  const nativeLangId = await resolveNativeLangId(ctx);
  const text = renderDictionaryEntry(entry, getLangCodeById, lang, { nativeLangId });
  const hasTranslations = entry.translations.length > 0;
  const kb = buildDictionaryEntryKeyboard(entryId, page, lang, dictionaryId, { hasTranslations });

  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
  } catch (err) {
    logger.error({ err }, "Failed to edit dictionary message");
  }
  ctx.session.dictionary = { ...(ctx.session.dictionary ?? {}), currentPage: page, dictionaryId };
  await ctx.answerCallbackQuery();
}

export async function handleDictDelete(ctx: BotContext): Promise<void> {
  const parts = (ctx.callbackQuery?.data ?? "").split(":");
  const dictionaryId = parsePositiveInteger(parts[2]) ?? ctx.session.dictionary?.dictionaryId;
  const entryId = parsePositiveInteger(parts[3]);
  const page = parsePositiveInteger(parts[4]) ?? ctx.session.dictionary?.currentPage ?? 1;

  if (!dictionaryId || !entryId) {
    await answerNoResults(ctx);
    return;
  }

  const lang = await getUserLang(ctx);
  const entry = await getOwnedEntry(ctx, entryId);
  if (!entry) {
    await ctx.answerCallbackQuery({ text: t("noResults", lang) });
    return;
  }

  const text = t("dictionaryDeleteConfirm", lang, { word: entry.original });
  const kb = buildDeleteConfirmKeyboard(entryId, page, lang, dictionaryId);

  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
  } catch (err) {
    logger.error({ err }, "Failed to edit dictionary message");
  }
  ctx.session.dictionary = { ...(ctx.session.dictionary ?? {}), currentPage: page, dictionaryId };
  await ctx.answerCallbackQuery();
}

export async function handleDictConfirmDelete(ctx: BotContext): Promise<void> {
  const parts = (ctx.callbackQuery?.data ?? "").split(":");
  const dictionaryId = parsePositiveInteger(parts[2]) ?? ctx.session.dictionary?.dictionaryId;
  const entryId = parsePositiveInteger(parts[3]);
  const page = parsePositiveInteger(parts[4]) ?? 1;

  if (!dictionaryId || !entryId) {
    await answerNoResults(ctx);
    return;
  }

  const lang = await getUserLang(ctx);
  const entry = await getOwnedEntry(ctx, entryId);
  if (!entry) {
    await ctx.answerCallbackQuery({ text: t("noResults", lang) });
    return;
  }

  const remainingMemberships = await vocabularyDictionaryRepository.removeEntry(dictionaryId, entryId);
  if (remainingMemberships === 0) {
    await vocabularyRepository.hardDelete(entryId);
  }
  await ctx.answerCallbackQuery({ text: t("wordDeleted", lang) });
  await showDictionaryList(ctx, dictionaryId, page);
}

export async function handleDictList(ctx: BotContext): Promise<void> {
  await showSwitcher(ctx);
  await ctx.answerCallbackQuery();
}

export async function handleDictOpen(ctx: BotContext): Promise<void> {
  const dictionaryId = parsePositiveInteger((ctx.callbackQuery?.data ?? "").split(":")[2]);
  if (!dictionaryId) {
    await answerNoResults(ctx);
    return;
  }
  await showDictionaryList(ctx, dictionaryId, 1);
  await ctx.answerCallbackQuery();
}

export async function handleDictCreate(ctx: BotContext): Promise<void> {
  const lang = await getUserLang(ctx);
  ctx.session.dictionaryWizard = {
    action: "create",
    msgId: ctx.callbackQuery?.message?.message_id,
  };
  await ctx.editMessageText(t("dictionaryCreatePrompt", lang), {
    reply_markup: buildDictionaryNamePromptKeyboard(lang),
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
}

export async function handleDictRename(ctx: BotContext): Promise<void> {
  const dictionaryId = parsePositiveInteger((ctx.callbackQuery?.data ?? "").split(":")[2]);
  if (!dictionaryId) {
    await answerNoResults(ctx);
    return;
  }
  const dictionary = await getOwnedDictionary(ctx, dictionaryId);
  if (!dictionary || dictionary.isDefault) {
    await answerNoResults(ctx);
    return;
  }
  const lang = await getUserLang(ctx);
  ctx.session.dictionaryWizard = {
    action: "rename",
    dictionaryId,
    msgId: ctx.callbackQuery?.message?.message_id,
  };
  await ctx.editMessageText(t("dictionaryRenamePrompt", lang, { name: dictionary.name }), {
    reply_markup: buildDictionaryNamePromptKeyboard(lang),
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
}

export async function handleDictDeleteDictionary(ctx: BotContext): Promise<void> {
  const dictionaryId = parsePositiveInteger((ctx.callbackQuery?.data ?? "").split(":")[2]);
  if (!dictionaryId) {
    await answerNoResults(ctx);
    return;
  }
  const dictionary = await getOwnedDictionary(ctx, dictionaryId);
  if (!dictionary || dictionary.isDefault) {
    await answerNoResults(ctx);
    return;
  }
  const lang = await getUserLang(ctx);
  await ctx.editMessageText(t("dictionaryDeleteCollectionConfirm", lang, { name: dictionary.name }), {
    reply_markup: buildDictionaryDeleteConfirmKeyboard(dictionaryId, lang),
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
}

export async function handleDictConfirmDeleteDictionary(ctx: BotContext): Promise<void> {
  const dictionaryId = parsePositiveInteger((ctx.callbackQuery?.data ?? "").split(":")[2]);
  if (!dictionaryId) {
    await answerNoResults(ctx);
    return;
  }
  const lang = await getUserLang(ctx);
  const deleted = await vocabularyDictionaryRepository.delete(ctx.user.id, dictionaryId);
  await ctx.answerCallbackQuery({ text: deleted ? t("wordDeleted", lang) : t("noResults", lang) });
  await showSwitcher(ctx);
}

async function showEntryDictionaryChoices(ctx: BotContext, action: "add" | "move"): Promise<void> {
  const parts = (ctx.callbackQuery?.data ?? "").split(":");
  const fromDictionaryId = parsePositiveInteger(parts[2]) ?? ctx.session.dictionary?.dictionaryId;
  const entryId = parsePositiveInteger(parts[3]);
  const page = parsePositiveInteger(parts[4]) ?? ctx.session.dictionary?.currentPage ?? 1;
  if (!fromDictionaryId || !entryId) {
    await answerNoResults(ctx);
    return;
  }

  const lang = await getUserLang(ctx);
  const dictionaries =
    action === "add"
      ? await vocabularyDictionaryRepository.listOtherDictionaries(ctx.user.id, entryId)
      : (await vocabularyDictionaryRepository.listByUser(ctx.user.id)).filter((dict) => dict.id !== fromDictionaryId);

  if (dictionaries.length === 0) {
    await ctx.answerCallbackQuery({ text: t("dictionaryNoOtherDictionaries", lang), show_alert: true });
    return;
  }

  const text = action === "add" ? t("dictionaryAddToPrompt", lang) : t("dictionaryMoveToPrompt", lang);
  const kb = buildDictionaryChoiceKeyboard(dictionaries, action, fromDictionaryId, entryId, page, lang);
  await ctx.editMessageText(text, { reply_markup: kb, parse_mode: "HTML" });
  await ctx.answerCallbackQuery();
}

export async function handleDictAddMenu(ctx: BotContext): Promise<void> {
  await showEntryDictionaryChoices(ctx, "add");
}

export async function handleDictMoveMenu(ctx: BotContext): Promise<void> {
  await showEntryDictionaryChoices(ctx, "move");
}

export async function handleDictAdd(ctx: BotContext): Promise<void> {
  const parts = (ctx.callbackQuery?.data ?? "").split(":");
  const fromDictionaryId = parsePositiveInteger(parts[2]);
  const entryId = parsePositiveInteger(parts[3]);
  const toDictionaryId = parsePositiveInteger(parts[4]);
  const page = parsePositiveInteger(parts[5]) ?? 1;
  if (!fromDictionaryId || !entryId || !toDictionaryId) {
    await answerNoResults(ctx);
    return;
  }

  const lang = await getUserLang(ctx);
  const toDictionary = await getOwnedDictionary(ctx, toDictionaryId);
  const entry = await getOwnedEntry(ctx, entryId);
  if (!toDictionary || !entry) {
    await answerNoResults(ctx);
    return;
  }

  await vocabularyDictionaryRepository.addEntry(toDictionaryId, entryId);
  await ctx.answerCallbackQuery({ text: t("dictionaryEntryAdded", lang, { name: toDictionary.name }) });
  await showDictionaryList(ctx, fromDictionaryId, page);
}

export async function handleDictMove(ctx: BotContext): Promise<void> {
  const parts = (ctx.callbackQuery?.data ?? "").split(":");
  const fromDictionaryId = parsePositiveInteger(parts[2]);
  const entryId = parsePositiveInteger(parts[3]);
  const toDictionaryId = parsePositiveInteger(parts[4]);
  const page = parsePositiveInteger(parts[5]) ?? 1;
  if (!fromDictionaryId || !entryId || !toDictionaryId) {
    await answerNoResults(ctx);
    return;
  }

  const lang = await getUserLang(ctx);
  const toDictionary = await getOwnedDictionary(ctx, toDictionaryId);
  const moved = await vocabularyDictionaryRepository.moveEntry(ctx.user.id, fromDictionaryId, toDictionaryId, entryId);
  if (!moved || !toDictionary) {
    await answerNoResults(ctx);
    return;
  }

  await ctx.answerCallbackQuery({ text: t("dictionaryEntryMoved", lang, { name: toDictionary.name }) });
  await showDictionaryList(ctx, fromDictionaryId, page);
}

export async function handleDictClose(ctx: BotContext): Promise<void> {
  ctx.session.dictionary = undefined;
  ctx.session.dictionaryWizard = undefined;
  await cleanupTechnicalMessages(ctx);
  try {
    await ctx.deleteMessage();
  } catch {
    /* message may already be deleted */
  }
  try {
    await ctx.answerCallbackQuery();
  } catch {
    /* ignore */
  }
}

export async function handleDictNoop(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
}

/**
 * Translate a dictionary entry that has no translations.
 * Uses the full translation pipeline (same AI prompts as normal translate mode)
 * to generate translations with synonyms, examples, usage notes etc.
 */
export async function handleDictTranslate(ctx: BotContext): Promise<void> {
  const parts = (ctx.callbackQuery?.data ?? "").split(":");
  const dictionaryId = parsePositiveInteger(parts[2]);
  const entryId = parsePositiveInteger(parts[3]);
  const page = parsePositiveInteger(parts[4]);
  const lang = await getUserLang(ctx);

  if (!dictionaryId || !entryId || !page) {
    await ctx.answerCallbackQuery({ text: t("noResults", lang) });
    return;
  }

  const userId = ctx.user.id;
  const entry = await getOwnedEntry(ctx, entryId);
  if (!entry) {
    await ctx.answerCallbackQuery({ text: t("noResults", lang) });
    return;
  }

  await ctx.answerCallbackQuery();

  // Show loading state in the message itself (persists until translation completes)
  const nativeLangId = await resolveNativeLangId(ctx);
  const loadingText = renderDictionaryEntry(entry, getLangCodeById, lang, { nativeLangId });
  try {
    await ctx.editMessageText(`${loadingText}\n\n⏳ ${t("videoProcessingStarted", lang)}`, {
      parse_mode: "HTML",
      reply_markup: undefined,
    });
  } catch {
    // ignore
  }

  const settings = await userRepository.getSettings(userId);
  if (!settings) return;

  const sourceLangObj = getAllLangs().find((l) => l.id === entry.sourceLangId);
  if (!sourceLangObj) return;

  const targetLangs = settings.learningLangs.filter((l) => l !== sourceLangObj.code);
  if (settings.nativeLang !== sourceLangObj.code && !targetLangs.includes(settings.nativeLang)) {
    targetLangs.push(settings.nativeLang);
  }
  if (targetLangs.length === 0) return;

  try {
    const modelId =
      (await ctx.services.settings.getDefaultAIModelForPlan(ctx.user.subscriptionPlan)) ??
      (await ctx.services.settings.getDefaultAIModel()) ??
      "openai/gpt-5-nano";

    // Load user's translation template for output config
    // Use "phrase" context to ensure grammar breakdown is included (if enabled in template)
    const userTpl = await ctx.services.translationTemplateRepository.getByUserId(userId);
    const outputConfig = resolveOutputConfig(userTpl, "phrase");

    const decision = await withTimeout(
      translate(
        {
          word: entry.original,
          sourceLang: sourceLangObj.code,
          targetLangs,
          nativeLang: settings.nativeLang,
          model: modelId,
          userId,
          inputType: entry.inputType,
          outputConfig,
        },
        ctx.services.ai.generateObject,
      ),
      LONG_OP_TIMEOUT_MS,
    );

    if (decision.status === "needs_clarification") {
      logger.warn({ entryId, userId, status: decision.status }, "Dict translate: needs clarification");
      return;
    }

    const { output } = decision;
    const translationRows = Object.entries(output.translations)
      .map(([code, lt]) => {
        const found = getAllLangs().find((l) => l.code === code);
        if (!found) return null;
        return {
          targetLangId: found.id,
          text: lt.text,
          expressionType: lt.expressionType ?? undefined,
          equivalentNote: lt.equivalentNote ?? undefined,
          usageNote: lt.usageNote ?? undefined,
          connotationWarning: lt.connotationWarning ?? undefined,
          details: {
            synonyms: lt.synonyms ?? [],
            examples: lt.examples ?? [],
            alternatives: lt.alternatives ?? undefined,
          },
        };
      })
      .filter((r) => r !== null);

    if (translationRows.length > 0) {
      await vocabularyRepository.updateAllTranslations(entryId, translationRows);
    }

    // Update entry-level fields (emoji, nativeMeaning, sourceUsage with examples)
    await vocabularyRepository.updateEntry(entryId, {
      emoji: output.emoji || entry.emoji,
      nativeMeaning: output.nativeMeaning || entry.nativeMeaning,
      sourceUsage: output.sourceUsage ?? entry.sourceUsage,
    });

    // Render using the SAME renderer as normal translate mode — identical output
    const templateFields = resolveTemplate(userTpl).fields;
    const translationText = renderTranslation(output, lang, templateFields, settings.nativeLang);

    // Update the message with the translation result + dictionary buttons
    const updatedEntry = await vocabularyRepository.findById(entryId);
    const hasTranslations = (updatedEntry?.translations.length ?? 0) > 0;
    const kb = buildDictionaryEntryKeyboard(entryId, page, lang, dictionaryId, { hasTranslations });
    try {
      await ctx.editMessageText(translationText, { parse_mode: "HTML", reply_markup: kb });
    } catch {
      // Message unchanged
    }
  } catch (err) {
    logger.error({ err, entryId, userId }, "Failed to translate dictionary entry");
    // Restore the card on error
    const text = renderDictionaryEntry(entry, getLangCodeById, lang, { nativeLangId });
    const kb = buildDictionaryEntryKeyboard(entryId, page, lang, dictionaryId, { hasTranslations: false });
    const failureNote = isUserFacingTimeout(err) ? t("loadingTimeout", lang) : `❌ ${t("videoProcessingFailed", lang)}`;
    try {
      await ctx.editMessageText(`${text}\n\n${failureNote}`, {
        parse_mode: "HTML",
        reply_markup: kb,
      });
    } catch {
      // ignore
    }
  }
}
