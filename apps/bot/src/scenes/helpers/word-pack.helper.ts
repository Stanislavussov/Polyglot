/**
 * Word packs (Task 87) — an admin turns a dictionary into a pack of striking
 * words that lapsed learners are won back with.
 */
import type { AudienceGroup, PackSourceWord, SupportedLang } from "@polyglot/core";
import { errorFields, isSupported, localizePackWords, logEvent, t, WORD_PACK_MIN_LEVEL } from "@polyglot/core";
import { wordPackPublishCounter } from "../../metrics.js";
import type { BotContext } from "../../types.js";
import { resolveDefaultAIModel } from "../../utils/ai-model.js";

/** A pack is published from one dictionary; a bigger one would be one long AI job in the admin's chat. */
const MAX_PACK_SOURCE_WORDS = 300;

export function canPublishWordPack(audienceGroup: AudienceGroup): boolean {
  return audienceGroup === "admin";
}

async function interfaceLang(ctx: BotContext): Promise<SupportedLang> {
  const lang = (await ctx.services.userRepository.getSettings(ctx.user.id))?.interfaceLang;
  return lang && isSupported(lang) ? lang : "en";
}

async function sourceWords(ctx: BotContext, dictionaryId: number): Promise<PackSourceWord[]> {
  const entries = await ctx.services.vocabularyRepository.findByUserPaginated(
    ctx.user.id,
    0,
    MAX_PACK_SOURCE_WORDS,
    dictionaryId,
  );
  const codeOf = new Map(ctx.services.languageCache.getAllLangs().map((lang) => [lang.id, lang.code]));
  return entries.flatMap((entry) => {
    const lang = codeOf.get(entry.sourceLangId);
    return lang && !entry.unverified ? [{ headword: entry.original, lang }] : [];
  });
}

/** `dict:pack:<dictionaryId>` — localize the dictionary and publish it as a pack. */
export async function handleDictPack(ctx: BotContext): Promise<void> {
  const lang = await interfaceLang(ctx);
  const dictionaryId = Number.parseInt((ctx.callbackQuery?.data ?? "").split(":")[2] ?? "", 10);
  // The button is only drawn for admins; the role is checked again because a
  // callback can be sent from any client, not only from the button.
  const dictionary =
    canPublishWordPack(ctx.user.audienceGroup) && dictionaryId > 0
      ? await ctx.services.vocabularyDictionaryRepository.findOwnedById(ctx.user.id, dictionaryId)
      : null;
  if (!dictionary) {
    await ctx.answerCallbackQuery({ text: t("noResults", lang) });
    return;
  }

  await ctx.answerCallbackQuery();
  await ctx.reply(t("wordPackPublishing", lang, { name: dictionary.name }));

  try {
    const outcome = await localizePackWords(
      {
        words: await sourceWords(ctx, dictionary.id),
        languages: ctx.services.languageCache.getSupportedLangs().map(({ code, name }) => ({ code, name })),
        minLevel: WORD_PACK_MIN_LEVEL,
      },
      {
        generateObjectFn: ctx.services.ai.generateObject,
        modelId: await resolveDefaultAIModel(ctx.services.settings, ctx.user.subscriptionPlan),
      },
    );

    if (outcome.items.length === 0) {
      wordPackPublishCounter.inc({ result: "empty" });
      await ctx.reply(t("wordPackNothing", lang, { name: dictionary.name }));
      return;
    }

    const pack = await ctx.services.wordPackRepository.publishFromDictionary({
      dictionaryId: dictionary.id,
      createdByUserId: ctx.user.id,
      title: dictionary.name,
      emoji: "📦",
    });
    await ctx.services.wordPackRepository.upsertItems(pack.id, outcome.items);
    const kept = await ctx.services.wordPackRepository.countActiveItems(pack.id);

    wordPackPublishCounter.inc({ result: "published" });
    logEvent("word_pack.published", {
      packId: pack.id,
      kept,
      tooEasy: outcome.tooEasy.length,
      unresolved: outcome.unresolved.length,
    });
    await ctx.reply(t("wordPackPublished", lang, { name: dictionary.name, kept, tooEasy: outcome.tooEasy.length }));
  } catch (err) {
    wordPackPublishCounter.inc({ result: "failed" });
    logEvent("word_pack.publish_failed", { dictionaryId: dictionary.id, ...errorFields(err) }, "error");
    await ctx.reply(t("wordPackFailed", lang));
  }
}
