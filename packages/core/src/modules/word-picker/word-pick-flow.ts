/**
 * The word-picker flow both channels run: generate a set for an angle, persist it as
 * a run, and save an item into the dictionary. The bot and the web app differ only
 * in how they show it.
 */
import type { ServiceContainer } from "../../ports/container.js";
import type { WordPickerItem, WordPickerPreset, WordPickerRun } from "../../ports/word-picker.repository.js";
import { resolveDefaultAIModel } from "../../shared/ai-model.js";
import { buildQuotaPorts, recordAiUsage } from "../entitlements/quota.js";
import { type EnrichEntryInput, enrichSavedEntry } from "../vocabulary/enrich-saved-entry.js";
import { pickWords } from "./pick.service.js";

/** Items per generated set — one screenful of Telegram message plus its buttons. */
const ITEMS_PER_SET = 8;

/** Words excluded from a new set: everything already shown for this angle plus the user's dictionary. */
const MAX_KNOWN_WORDS = 300;

const DEFAULT_LEVEL = "B1";

export type WordPickDeps = Pick<
  ServiceContainer,
  | "userRepository"
  | "settings"
  | "ai"
  | "languageCache"
  | "vocabularyRepository"
  | "vocabularyDictionaryRepository"
  | "wordPickerRunRepository"
  | "translationRequestRepository"
  | "translationTemplateRepository"
>;

export function presetTitle(preset: WordPickerPreset, lang: string): string {
  return preset.titleI18n[lang]?.trim() || preset.title;
}

/** Learning languages this angle is offered for — an unscoped preset accepts them all. */
export function eligiblePresetLangs(preset: WordPickerPreset, learningLangs: string[]): string[] {
  if (preset.learningLangs.length === 0) return learningLangs;
  return learningLangs.filter((code) => preset.learningLangs.includes(code));
}

/**
 * Words this angle must not produce again: everything already shown for it in this
 * language, plus everything the learner has saved in that language. Without this
 * the second tap of "more words" returns the same obvious eight items.
 */
async function collectKnownWords(
  deps: WordPickDeps,
  userId: number,
  presetId: number,
  langCode: string,
): Promise<string[]> {
  const sourceLang = deps.languageCache.getLang(langCode);
  const [shown, saved] = await Promise.all([
    deps.wordPickerRunRepository.findWordsShownTo(userId, presetId, langCode, MAX_KNOWN_WORDS),
    sourceLang ? deps.vocabularyRepository.findOriginalsByUserAndSource(userId, sourceLang.id) : Promise.resolve([]),
  ]);
  return [...shown, ...saved];
}

export interface WordPickSetRequest {
  userId: number;
  plan: string;
  preset: WordPickerPreset;
  langCode: string;
  /** The interface language the preset title is stored in on the run. */
  interfaceLang: string;
  /** From the caller's credit check, which runs first so it can refuse in its own words. */
  creditCost: number;
}

export type WordPickOutcome =
  | { status: "failed"; error: unknown }
  | { status: "empty" }
  | { status: "generated"; run: WordPickerRun; items: WordPickerItem[] };

export async function generateWordPickSet(deps: WordPickDeps, request: WordPickSetRequest): Promise<WordPickOutcome> {
  const { userId, preset, langCode } = request;
  const settings = await deps.userRepository.getSettings(userId);
  const nativeLang = settings?.nativeLang ?? "en";
  const levels = await deps.userRepository.getLanguageLevels(userId);
  const level = levels.find((entry) => entry.languageCode === langCode)?.proficiencyLevel ?? DEFAULT_LEVEL;
  const knownWords = await collectKnownWords(deps, userId, preset.id, langCode);
  const model = await resolveDefaultAIModel(deps.settings, request.plan);

  let picked: Awaited<ReturnType<typeof pickWords>>;
  try {
    picked = await pickWords(
      {
        angleTitle: presetTitle(preset, request.interfaceLang),
        anglePrompt: preset.prompt,
        learningLanguage: deps.languageCache.getLangName(langCode, "en"),
        nativeLanguage: deps.languageCache.getLangName(nativeLang, "en"),
        level,
        count: ITEMS_PER_SET,
        knownWords,
      },
      { generateObjectFn: deps.ai.generateObject, modelId: model },
    );
  } catch (error) {
    return { status: "failed", error };
  }

  // The call happened, so it is billed whether or not the angle had anything new left.
  await recordAiUsage(buildQuotaPorts(deps), userId, "wordPick", request.creditCost, langCode, [nativeLang]);
  if (picked.length === 0) return { status: "empty" };

  const run = await deps.wordPickerRunRepository.createRun({
    userId,
    presetId: preset.id,
    presetTitle: presetTitle(preset, request.interfaceLang),
    presetEmoji: preset.emoji,
    langCode,
    nativeLang,
  });
  const items = await deps.wordPickerRunRepository.saveItems(
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
  return { status: "generated", run, items };
}

type SavableRun = Pick<WordPickerRun, "id" | "presetTitle" | "langCode" | "nativeLang">;
type SavableItem = Pick<
  WordPickerItem,
  "id" | "word" | "nativeTranslation" | "emoji" | "itemType" | "exampleTarget" | "exampleNative" | "note"
>;

export interface SavePickedItemOptions {
  plan?: string;
  onEnriched?: EnrichEntryInput["onOutcome"];
}

/**
 * Saves one picked item into the default dictionary — or links the entry the user
 * already has for that word — and upgrades a new entry to a full card in the background.
 */
export async function savePickedItem(
  deps: WordPickDeps,
  userId: number,
  run: SavableRun,
  item: SavableItem,
  sourceLangId: number,
  options: SavePickedItemOptions = {},
): Promise<void> {
  const existing = await deps.vocabularyRepository.findByOriginalAndSource(userId, item.word, sourceLangId);
  if (existing) {
    await deps.wordPickerRunRepository.markItemSaved(item.id, existing.id);
    return;
  }

  const inputType = item.itemType === "word" ? ("word" as const) : ("phrase" as const);
  const examples = item.exampleTarget
    ? [{ context: item.exampleTarget, target: item.exampleNative ?? item.nativeTranslation }]
    : [];
  const nativeLang = deps.languageCache.getLang(run.nativeLang);
  const translations = nativeLang
    ? [{ targetLangId: nativeLang.id, text: item.nativeTranslation, details: { synonyms: [], examples } }]
    : [];

  const entry = await deps.vocabularyRepository.create(userId, {
    original: item.word,
    sourceLangId,
    inputType,
    emoji: item.emoji ?? "",
    nativeMeaning: item.nativeTranslation,
    sourceUsage: { explanation: item.note ?? item.nativeTranslation, synonyms: [], examples },
    source: { type: "wordPicker", runId: run.id, presetTitle: run.presetTitle },
    translations,
  });
  await deps.vocabularyDictionaryRepository.addEntryToDefault(userId, entry.id);
  await deps.wordPickerRunRepository.markItemSaved(item.id, entry.id);

  void enrichSavedEntry(deps, {
    entryId: entry.id,
    word: item.word,
    inputType,
    sourceLangCode: run.langCode,
    userId,
    ...(options.plan ? { plan: options.plan } : {}),
    ...(options.onEnriched ? { onOutcome: options.onEnriched } : {}),
  });
}
