/**
 * Word picker — the "I opened the bot, now what?" entry point.
 *
 * An admin authors *angles* on a language (`word_picker_presets`): not "at the
 * pharmacy", but "words your language has no name for", "false friends", "grammar
 * your language doesn't have". The user picks one, the model produces a set for
 * their learning language and level, and every item can go into their dictionary
 * with one tap.
 */

import { isSupported, logger, pickWords, type SupportedLang, t, type WordPickerPreset } from "@polyglot/core";
import { wordPickCounter, wordPickEnrichmentCounter } from "../../metrics.js";
import {
  buildLangKeyboard,
  buildPickedSetKeyboard,
  buildPresetListKeyboard,
  presetTitle,
  renderPickedSet,
  renderPresetList,
} from "../../renderers/word-picker.renderer.js";
import type { BotContext } from "../../types.js";
import { resolveDefaultAIModel } from "../../utils/ai-model.js";
import { ensureAiQuota, recordAiUsage } from "../../utils/ai-quota.js";
import { editMessageTextOrReply } from "./edit-message.helper.js";
import { enrichEntryInBackground } from "./entry-enrichment.helper.js";

/** Items per generated set — one screenful of Telegram message plus its buttons. */
const ITEMS_PER_SET = 8;

/** Words excluded from a new set: everything already shown for this angle plus the user's dictionary. */
const MAX_KNOWN_WORDS = 300;

const DEFAULT_LEVEL = "B1";

async function resolveInterfaceLang(ctx: BotContext): Promise<SupportedLang> {
  const userId = ctx.user?.id;
  if (!userId) return "en";
  const settings = await ctx.services.userRepository.getSettings(userId);
  const rawLang = settings?.interfaceLang ?? "en";
  return isSupported(rawLang) ? rawLang : "en";
}

function langLabel(ctx: BotContext, code: string, lang: SupportedLang): string {
  const flag = ctx.services.languageCache.getLangFlag(code);
  const name = ctx.services.languageCache.getLangName(code, lang);
  return flag ? `${flag} ${name}` : name;
}

/** Learning languages this angle is offered for — an unscoped preset accepts them all. */
function eligibleLangs(preset: WordPickerPreset, learningLangs: string[]): string[] {
  if (preset.learningLangs.length === 0) return learningLangs;
  return learningLangs.filter((code) => preset.learningLangs.includes(code));
}

/* ------------------------------------------------------------------ */
/*  Entry point — main-menu tap and /pick                              */
/* ------------------------------------------------------------------ */

export async function handlePickWordsCommand(ctx: BotContext): Promise<void> {
  const userId = ctx.user?.id;
  if (!userId) return;

  const lang = await resolveInterfaceLang(ctx);
  const settings = await ctx.services.userRepository.getSettings(userId);
  const learningLangs = settings?.learningLangs ?? [];

  if (learningLangs.length === 0) {
    await ctx.reply(t("pickNoLanguage", lang));
    return;
  }

  const presets = await ctx.services.wordPickerPresetRepository.findActiveForLangs(learningLangs);
  if (presets.length === 0) {
    await ctx.reply(t("pickNoPresets", lang));
    return;
  }

  await ctx.reply(renderPresetList(lang), {
    parse_mode: "HTML",
    reply_markup: buildPresetListKeyboard(presets, lang),
  });
}

/* ------------------------------------------------------------------ */
/*  Callback handlers                                                  */
/* ------------------------------------------------------------------ */

export async function handlePickPresetCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const userId = ctx.user?.id;
  if (!data || !userId) return;
  await ctx.answerCallbackQuery();

  const presetId = Number.parseInt(data.split(":")[2] ?? "", 10);
  if (Number.isNaN(presetId)) return;

  const lang = await resolveInterfaceLang(ctx);
  const preset = await ctx.services.wordPickerPresetRepository.findById(presetId);
  if (!preset?.isActive) {
    await editMessageTextOrReply(ctx, t("pickPresetGone", lang));
    return;
  }

  const settings = await ctx.services.userRepository.getSettings(userId);
  const langs = eligibleLangs(preset, settings?.learningLangs ?? []);

  if (langs.length === 0) {
    await editMessageTextOrReply(ctx, t("pickNoLanguage", lang));
    return;
  }

  // One learning language means there is nothing to choose — skip straight to the set.
  if (langs.length === 1) {
    await generateAndShowSet(ctx, preset, langs[0]!, lang, { progressBy: "edit" });
    return;
  }

  await editMessageTextOrReply(ctx, t("pickChooseLang", lang), {
    reply_markup: buildLangKeyboard(
      preset.id,
      langs.map((code) => ({ code, label: langLabel(ctx, code, lang) })),
      lang,
    ),
  });
}

export async function handlePickLangCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;
  await ctx.answerCallbackQuery();

  const parts = data.split(":");
  const presetId = Number.parseInt(parts[2] ?? "", 10);
  const langCode = parts.slice(3).join(":");
  if (Number.isNaN(presetId) || langCode.length === 0) return;

  const lang = await resolveInterfaceLang(ctx);
  const preset = await ctx.services.wordPickerPresetRepository.findById(presetId);
  if (!preset?.isActive) {
    await editMessageTextOrReply(ctx, t("pickPresetGone", lang));
    return;
  }

  await generateAndShowSet(ctx, preset, langCode, lang, { progressBy: "edit" });
}

export async function handlePickMoreCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const userId = ctx.user?.id;
  if (!data || !userId) return;
  await ctx.answerCallbackQuery();

  const runId = Number.parseInt(data.split(":")[2] ?? "", 10);
  if (Number.isNaN(runId)) return;

  const lang = await resolveInterfaceLang(ctx);
  const run = await ctx.services.wordPickerRunRepository.findRunById(runId);
  if (!run || run.userId !== userId || run.presetId === null) {
    await ctx.answerCallbackQuery({ text: t("pickStale", lang) });
    return;
  }

  const preset = await ctx.services.wordPickerPresetRepository.findById(run.presetId);
  if (!preset?.isActive) {
    await ctx.reply(t("pickPresetGone", lang));
    return;
  }

  // A new message rather than an edit: the set already on screen has unsaved items
  // the user may still want, and "more" is an addition, not a replacement.
  await generateAndShowSet(ctx, preset, run.langCode, lang, { progressBy: "reply" });
}

export async function handlePickSaveCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const userId = ctx.user?.id;
  if (!data || !userId) return;

  const itemId = Number.parseInt(data.split(":")[2] ?? "", 10);
  if (Number.isNaN(itemId)) return;

  const lang = await resolveInterfaceLang(ctx);
  const item = await ctx.services.wordPickerRunRepository.findItemById(itemId);
  const run = item ? await ctx.services.wordPickerRunRepository.findRunById(item.runId) : null;
  if (!item || !run || run.userId !== userId) {
    await ctx.answerCallbackQuery({ text: t("pickStale", lang) });
    return;
  }

  if (item.savedEntryId) {
    await ctx.answerCallbackQuery({ text: t("pickAlreadySaved", lang) });
    return;
  }

  const sourceLang = ctx.services.languageCache.getLang(run.langCode);
  if (!sourceLang) {
    await ctx.answerCallbackQuery({ text: t("pickStale", lang) });
    return;
  }

  await saveItem(ctx, userId, run, item, sourceLang.id);
  await ctx.answerCallbackQuery({ text: t("pickSaved", lang) });
  await rerenderSet(ctx, run.id, lang);
}

export async function handlePickSaveAllCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  const userId = ctx.user?.id;
  if (!data || !userId) return;

  const runId = Number.parseInt(data.split(":")[2] ?? "", 10);
  if (Number.isNaN(runId)) return;

  const lang = await resolveInterfaceLang(ctx);
  const run = await ctx.services.wordPickerRunRepository.findRunById(runId);
  if (!run || run.userId !== userId) {
    await ctx.answerCallbackQuery({ text: t("pickStale", lang) });
    return;
  }

  const sourceLang = ctx.services.languageCache.getLang(run.langCode);
  if (!sourceLang) {
    await ctx.answerCallbackQuery({ text: t("pickStale", lang) });
    return;
  }

  const unsaved = await ctx.services.wordPickerRunRepository.findUnsavedItemsByRun(runId);
  for (const item of unsaved) {
    await saveItem(ctx, userId, run, item, sourceLang.id);
  }

  await ctx.answerCallbackQuery({ text: `✅ ${unsaved.length}` });
  await rerenderSet(ctx, runId, lang);
}

export async function handlePickCloseCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  try {
    await ctx.deleteMessage();
  } catch {
    // Already gone, or older than Telegram's deletion window.
  }
}

export async function handlePickNoopCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
}

/* ------------------------------------------------------------------ */
/*  Generation                                                         */
/* ------------------------------------------------------------------ */

interface GenerateOptions {
  /** Where the "picking words…" notice goes: over the tapped menu, or as a new message. */
  progressBy: "edit" | "reply";
}

async function generateAndShowSet(
  ctx: BotContext,
  preset: WordPickerPreset,
  langCode: string,
  lang: SupportedLang,
  options: GenerateOptions,
): Promise<void> {
  const userId = ctx.user?.id;
  if (!userId) return;

  const creditCost = await ensureAiQuota(ctx, ctx.user.subscriptionPlan, lang, "wordPick");
  if (creditCost === null) return;

  let progressMessageId: number | undefined;
  if (options.progressBy === "edit") {
    await editMessageTextOrReply(ctx, t("pickGenerating", lang));
  } else {
    const notice = await ctx.reply(t("pickGenerating", lang));
    progressMessageId = notice.message_id;
  }

  const settings = await ctx.services.userRepository.getSettings(userId);
  const nativeLang = settings?.nativeLang ?? "en";
  const levels = await ctx.services.userRepository.getLanguageLevels(userId);
  const level = levels.find((entry) => entry.languageCode === langCode)?.proficiencyLevel ?? DEFAULT_LEVEL;

  const knownWords = await collectKnownWords(ctx, userId, preset.id, langCode);
  const model = await resolveDefaultAIModel(ctx.services.settings, ctx.user.subscriptionPlan);

  let picked: Awaited<ReturnType<typeof pickWords>>;
  try {
    picked = await pickWords(
      {
        angleTitle: presetTitle(preset, lang),
        anglePrompt: preset.prompt,
        learningLanguage: ctx.services.languageCache.getLangName(langCode, "en"),
        nativeLanguage: ctx.services.languageCache.getLangName(nativeLang, "en"),
        level,
        count: ITEMS_PER_SET,
        knownWords,
      },
      { generateObjectFn: ctx.services.ai.generateObject, modelId: model },
    );
  } catch (error) {
    wordPickCounter.inc({ status: "failed" });
    logger.error(
      { presetId: preset.id, langCode, error: error instanceof Error ? error.message : String(error) },
      "Word pick failed",
    );
    await ctx.reply(t("pickFailed", lang));
    return;
  }

  // The call happened, so it is billed whether or not the angle had anything new left.
  await recordAiUsage(ctx, "wordPick", creditCost, langCode, [nativeLang]);

  if (picked.length === 0) {
    wordPickCounter.inc({ status: "empty" });
    await offerOtherAngles(ctx, userId, preset, lang, options.progressBy, progressMessageId);
    return;
  }

  const run = await ctx.services.wordPickerRunRepository.createRun({
    userId,
    presetId: preset.id,
    presetTitle: presetTitle(preset, lang),
    presetEmoji: preset.emoji,
    langCode,
    nativeLang,
  });

  const items = await ctx.services.wordPickerRunRepository.saveItems(
    run.id,
    picked.map((item) => ({
      word: item.word,
      nativeTranslation: item.nativeTranslation,
      emoji: item.emoji,
      itemType: item.type,
      level: item.level,
      exampleTarget: item.exampleTarget,
      exampleNative: item.exampleNative,
      note: item.note,
    })),
  );

  wordPickCounter.inc({ status: "generated" });

  await ctx.reply(renderPickedSet(run, items, langLabel(ctx, langCode, lang), lang), {
    parse_mode: "HTML",
    reply_markup: buildPickedSetKeyboard(run, items, lang),
    link_preview_options: { is_disabled: true },
  });

  await dropProgressNotice(ctx, progressMessageId);
}

async function dropProgressNotice(ctx: BotContext, progressMessageId: number | undefined): Promise<void> {
  if (progressMessageId === undefined) return;
  try {
    await ctx.api.deleteMessage(ctx.chat?.id ?? 0, progressMessageId);
  } catch {
    // The sweep will take it on the next message.
  }
}

/**
 * An exhausted angle used to end the flow on a sentence: "try another one" with no
 * other one in reach, so the only way on was to re-open the menu by hand. The
 * notice now carries the angle list itself — minus the angle that just came up
 * empty, since offering it again only invites a second billed call for the same
 * nothing.
 *
 * With no other angle left there is nothing to hand back, and the plain notice is
 * the honest ending.
 */
async function offerOtherAngles(
  ctx: BotContext,
  userId: number,
  exhausted: WordPickerPreset,
  lang: SupportedLang,
  progressBy: GenerateOptions["progressBy"],
  progressMessageId: number | undefined,
): Promise<void> {
  const settings = await ctx.services.userRepository.getSettings(userId);
  const presets = await ctx.services.wordPickerPresetRepository.findActiveForLangs(settings?.learningLangs ?? []);
  const others = presets.filter((preset) => preset.id !== exhausted.id);

  const text = t("pickNothingNew", lang);
  const markup = others.length > 0 ? { reply_markup: buildPresetListKeyboard(others, lang) } : {};

  if (progressBy === "edit") {
    await editMessageTextOrReply(ctx, text, markup);
    return;
  }
  await ctx.reply(text, markup);
  await dropProgressNotice(ctx, progressMessageId);
}

/**
 * Words this angle must not produce again: everything already shown for it in this
 * language, plus everything the learner has saved in that language. Without this
 * the second tap of "more words" returns the same obvious eight items.
 */
async function collectKnownWords(
  ctx: BotContext,
  userId: number,
  presetId: number,
  langCode: string,
): Promise<string[]> {
  const sourceLang = ctx.services.languageCache.getLang(langCode);
  const [shown, saved] = await Promise.all([
    ctx.services.wordPickerRunRepository.findWordsShownTo(userId, presetId, langCode, MAX_KNOWN_WORDS),
    sourceLang
      ? ctx.services.vocabularyRepository.findOriginalsByUserAndSource(userId, sourceLang.id)
      : Promise.resolve([]),
  ]);
  return [...shown, ...saved];
}

/* ------------------------------------------------------------------ */
/*  Saving                                                             */
/* ------------------------------------------------------------------ */

interface SavableRun {
  id: number;
  presetTitle: string;
  langCode: string;
  nativeLang: string;
}

interface SavableItem {
  id: number;
  word: string;
  nativeTranslation: string;
  emoji: string | null;
  itemType: string | null;
  exampleTarget: string | null;
  exampleNative: string | null;
  note: string | null;
}

async function saveItem(
  ctx: BotContext,
  userId: number,
  run: SavableRun,
  item: SavableItem,
  sourceLangId: number,
): Promise<void> {
  const existing = await ctx.services.vocabularyRepository.findByOriginalAndSource(userId, item.word, sourceLangId);
  if (existing) {
    await ctx.services.wordPickerRunRepository.markItemSaved(item.id, existing.id);
    return;
  }

  const inputType = item.itemType === "word" ? ("word" as const) : ("phrase" as const);
  const examples = item.exampleTarget
    ? [{ context: item.exampleTarget, target: item.exampleNative ?? item.nativeTranslation }]
    : [];

  const nativeLang = ctx.services.languageCache.getLang(run.nativeLang);
  const translations = nativeLang
    ? [
        {
          targetLangId: nativeLang.id,
          text: item.nativeTranslation,
          details: { synonyms: [], examples },
        },
      ]
    : [];

  const entry = await ctx.services.vocabularyRepository.create(userId, {
    original: item.word,
    sourceLangId,
    inputType,
    emoji: item.emoji ?? "",
    nativeMeaning: item.nativeTranslation,
    sourceUsage: { explanation: item.note ?? item.nativeTranslation, synonyms: [], examples },
    source: { type: "wordPicker", runId: run.id, presetTitle: run.presetTitle },
    translations,
  });

  await ctx.services.vocabularyDictionaryRepository.addEntryToDefault(userId, entry.id);
  await ctx.services.wordPickerRunRepository.markItemSaved(item.id, entry.id);

  void enrichEntryInBackground(ctx, {
    entryId: entry.id,
    word: item.word,
    inputType,
    sourceLangCode: run.langCode,
    userId,
    onOutcome: (status) => wordPickEnrichmentCounter.inc({ status }),
  });
}

async function rerenderSet(ctx: BotContext, runId: number, lang: SupportedLang): Promise<void> {
  const run = await ctx.services.wordPickerRunRepository.findRunById(runId);
  if (!run) return;
  const items = await ctx.services.wordPickerRunRepository.findItemsByRun(runId);

  await editMessageTextOrReply(ctx, renderPickedSet(run, items, langLabel(ctx, run.langCode, lang), lang), {
    parse_mode: "HTML",
    reply_markup: buildPickedSetKeyboard(run, items, lang),
    link_preview_options: { is_disabled: true },
  });
}
