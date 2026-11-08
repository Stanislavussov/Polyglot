import {
  eligiblePresetLangs,
  errorFields,
  generateWordPickSet,
  logEvent,
  presetTitle,
  type SupportedLang,
  savePickedItem,
  type WordPickerItem,
  type WordPickerPreset,
  type WordPickerRun,
} from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";
import { learnerSettings, meterCredits } from "./learn-shared.js";

const setBody = z.object({ presetId: z.number().int().positive(), lang: z.string().min(2).max(8) });
const idParam = z.object({ id: z.coerce.number().int().positive() });

function langOption(services: WebServices, code: string, lang: SupportedLang) {
  return { code, flag: services.languageCache.getLangFlag(code), name: services.languageCache.getLangName(code, lang) };
}

function presetView(services: WebServices, preset: WordPickerPreset, learningLangs: string[], lang: SupportedLang) {
  return {
    id: preset.id,
    emoji: preset.emoji,
    title: presetTitle(preset, lang),
    langs: eligiblePresetLangs(preset, learningLangs).map((code) => langOption(services, code, lang)),
  };
}

function setView(services: WebServices, run: WordPickerRun, items: WordPickerItem[], lang: SupportedLang) {
  return {
    run: {
      id: run.id,
      presetId: run.presetId,
      title: run.presetTitle,
      emoji: run.presetEmoji,
      lang: langOption(services, run.langCode, lang),
    },
    items: items.map((item) => ({
      id: item.id,
      word: item.word,
      nativeTranslation: item.nativeTranslation,
      emoji: item.emoji,
      type: item.itemType,
      level: item.level,
      exampleTarget: item.exampleTarget,
      exampleNative: item.exampleNative,
      note: item.note,
      saved: item.savedEntryId !== null,
    })),
  };
}

/** The bot's word picker (`lrn:pick`): angles, a generated set, and saving its items. */
export function wordPickerRoutes(app: FastifyInstance, services: WebServices): void {
  app.get("/api/word-picker/presets", async (request) => {
    const { settings, lang } = await learnerSettings(services, request.learner);
    const learningLangs = settings?.learningLangs ?? [];
    if (learningLangs.length === 0) return { presets: [], noLanguage: true };
    const presets = await services.wordPickerPresetRepository.findActiveForLangs(learningLangs);
    return { presets: presets.map((preset) => presetView(services, preset, learningLangs, lang)), noLanguage: false };
  });

  // "More words" is the same request again: the run history keeps the next set from repeating.
  app.post("/api/word-picker/sets", async (request, reply) => {
    const parsed = setBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_request" });
    const user = request.learner;
    const { settings, lang } = await learnerSettings(services, user);
    const preset = await services.wordPickerPresetRepository.findById(parsed.data.presetId);
    if (!preset?.isActive) return reply.status(404).send({ code: "preset_gone" });
    if (!eligiblePresetLangs(preset, settings?.learningLangs ?? []).includes(parsed.data.lang)) {
      return reply.status(422).send({ code: "no_language" });
    }

    const creditCost = await meterCredits(services, user, reply, "wordPick");
    if (creditCost === null) return reply;

    const outcome = await generateWordPickSet(services, {
      userId: user.id,
      plan: user.subscriptionPlan,
      preset,
      langCode: parsed.data.lang,
      interfaceLang: lang,
      creditCost,
    });
    if (outcome.status === "failed") {
      logEvent("word_pick.failed", { presetId: preset.id, channel: "web", ...errorFields(outcome.error) }, "error");
      return reply.status(502).send({ code: "pick_failed" });
    }
    if (outcome.status === "empty") {
      // An exhausted angle hands back the other angles, never itself: offering it again only invites a second billed call.
      const others = await services.wordPickerPresetRepository.findActiveForLangs(settings?.learningLangs ?? []);
      return {
        status: "empty",
        others: others
          .filter((other) => other.id !== preset.id)
          .map((other) => presetView(services, other, settings?.learningLangs ?? [], lang)),
      };
    }
    return { status: "generated", ...setView(services, outcome.run, outcome.items, lang) };
  });

  app.post("/api/word-picker/items/:id/save", async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_request" });
    const user = request.learner;
    const item = await services.wordPickerRunRepository.findItemById(params.data.id);
    const run = item ? await services.wordPickerRunRepository.findRunById(item.runId) : null;
    if (!item || !run || run.userId !== user.id) return reply.status(404).send({ code: "stale" });
    if (item.savedEntryId) return { saved: 0, alreadySaved: true };
    const sourceLang = services.languageCache.getLang(run.langCode);
    if (!sourceLang) return reply.status(404).send({ code: "stale" });
    await savePickedItem(services, user.id, run, item, sourceLang.id, { plan: user.subscriptionPlan });
    return { saved: 1, alreadySaved: false };
  });

  app.post("/api/word-picker/runs/:id/save-all", async (request, reply) => {
    const params = idParam.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ code: "invalid_request" });
    const user = request.learner;
    const run = await services.wordPickerRunRepository.findRunById(params.data.id);
    if (!run || run.userId !== user.id) return reply.status(404).send({ code: "stale" });
    const sourceLang = services.languageCache.getLang(run.langCode);
    if (!sourceLang) return reply.status(404).send({ code: "stale" });
    const unsaved = await services.wordPickerRunRepository.findUnsavedItemsByRun(run.id);
    for (const item of unsaved) {
      await savePickedItem(services, user.id, run, item, sourceLang.id, { plan: user.subscriptionPlan });
    }
    return { saved: unsaved.length, alreadySaved: false };
  });
}
