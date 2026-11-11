import {
  defaultFeatureAccess,
  FEATURE_KEYS,
  type FeatureState,
  hashTtsText,
  type LanguageOrderContext,
  languageOrderFromSettings,
  logEvent,
  normalizeTtsText,
  resolveFeatureStates,
  resolvePronounceableText,
  type SpeakableCard,
  selectPronounceableLangs,
  toTranslateOutput,
  type User,
  type VocabularyEntryWithTranslations,
} from "@polyglot/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { WebServices } from "../services.js";
import { langCode } from "./lang-code.js";

/** "off" = the admin turned TTS off; "locked" = the plan does not include it (the bot's 💎 badge). */
export type AudioAccess = FeatureState;

export async function languageOrder(services: WebServices, userId: number): Promise<LanguageOrderContext> {
  return languageOrderFromSettings(await services.userRepository.getSettings(userId));
}

export function speakableCard(services: WebServices, entry: VocabularyEntryWithTranslations): SpeakableCard {
  // The bot speaks a saved word from this same mapping (flashcards, notifications).
  return (
    toTranslateOutput(entry, (id) => langCode(services, id) || undefined) ?? {
      sourceLang: "",
      original: entry.original,
      translations: {},
    }
  );
}

export async function audioAccess(services: WebServices, user: User): Promise<AudioAccess> {
  const config = await services.settings.getTtsConfig();
  const off = !config.enabled || !config.modelId ? new Set([FEATURE_KEYS.pronunciation]) : new Set<string>();
  const access = services.featureAccess ?? defaultFeatureAccess;
  const states = await resolveFeatureStates(access, user, [FEATURE_KEYS.pronunciation], off);
  return states.get(FEATURE_KEYS.pronunciation) ?? "off";
}

/** The card's speaker buttons: which languages, and whether tapping one plays. */
export async function cardAudio(
  services: WebServices,
  user: User,
  entry: VocabularyEntryWithTranslations,
  order: LanguageOrderContext,
): Promise<{ langs: readonly string[]; access: AudioAccess }> {
  return {
    langs: selectPronounceableLangs(speakableCard(services, entry), order),
    access: await audioAccess(services, user),
  };
}

// The bot's tts_cache stores Telegram file_ids, useless to a browser. A small
// in-process cache keeps a replayed word from paying for synthesis twice.
const AUDIO_CACHE_SIZE = 200;
const audioCache = new Map<string, Uint8Array>();

function remember(key: string, bytes: Uint8Array): void {
  audioCache.delete(key);
  audioCache.set(key, bytes);
  if (audioCache.size > AUDIO_CACHE_SIZE) audioCache.delete(audioCache.keys().next().value ?? "");
}

const params = z.object({ entryId: z.coerce.number().int().positive(), lang: z.string().min(2).max(8) });

export function cardAudioRoutes(app: FastifyInstance, services: WebServices): void {
  // The text is resolved here from the saved entry, never taken from the client:
  // the audio always says the word the card shows, and nobody can spend credits on free text.
  app.get("/api/dictionary/:entryId/audio/:lang", async (request, reply) => {
    const parsed = params.safeParse(request.params);
    if (!parsed.success) return reply.status(400).send({ code: "invalid_entry" });
    const user = request.learner;
    const entry = await services.vocabularyRepository.findById(parsed.data.entryId);
    if (!entry || entry.userId !== user.id || !entry.isActive) return reply.status(404).send({ code: "not_found" });

    const access = await audioAccess(services, user);
    if (access === "locked") return reply.status(403).send({ code: "locked" });
    if (access === "off") return reply.status(503).send({ code: "tts_off" });

    const order = await languageOrder(services, user.id);
    const card = speakableCard(services, entry);
    if (!selectPronounceableLangs(card, order).includes(parsed.data.lang)) {
      return reply.status(404).send({ code: "not_found" });
    }
    const text = normalizeTtsText(resolvePronounceableText(card, parsed.data.lang, order));
    const config = await services.settings.getTtsConfig();
    if (text.length > config.maxChars) return reply.status(422).send({ code: "too_long" });

    const key = hashTtsText([parsed.data.lang, config.modelId, config.voice, text].join("\n"));
    let bytes = audioCache.get(key);
    const cached = bytes !== undefined;
    if (!bytes) {
      try {
        const speech = await services.ai.generateSpeech({
          text,
          modelId: config.modelId,
          voice: config.voice,
          userId: user.id,
        });
        bytes = speech.bytes;
      } catch {
        logEvent("card.tts_failed", { lang: parsed.data.lang, reason: "synthesis_failed", channel: "web" }, "error");
        return reply.status(502).send({ code: "tts_failed" });
      }
    }
    remember(key, bytes);
    logEvent("card.tts_played", { lang: parsed.data.lang, cached, chars: text.length, channel: "web" });
    return reply
      .header("content-type", "audio/mpeg")
      .header("cache-control", "private, max-age=604800")
      .send(Buffer.from(bytes));
  });
}
