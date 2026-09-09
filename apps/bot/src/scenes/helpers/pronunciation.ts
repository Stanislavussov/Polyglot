/**
 * Pronunciation callback (`tr:say:{langCode}:{msgId}`) — Task 77.
 *
 * Sends the card's word for that language — the source headword included — as a
 * voice message, captioned with the word being spoken. The card is deliberately
 * left untouched: pronunciation is a side effect, not a section, so unlike
 * grammar and etymology the button does not disappear after use and the card
 * text never changes.
 *
 * All policy (cap, cache, self-healing on a rejected file_id) lives in
 * `playPronunciation`; this module only supplies the three Telegram/OpenRouter
 * adapters it needs and translates the outcome into a callback answer.
 */
import {
  FEATURE_KEYS,
  isSupported,
  logEvent,
  playPronunciation,
  resolvePronounceableText,
  type SupportedLang,
  t,
} from "@polyglot/core";
import { InputFile } from "grammy";
import type { BotContext } from "../../types.js";
import { languageOrderFromSettings } from "../../utils/language-order.js";
import { ensurePaidFeature } from "./paid-feature.helper.js";
import { answerStaleCallback } from "./stale-callback.helper.js";

/** Parses `tr:say:{langCode}:{msgId}`. Returns null when the shape is unexpected. */
function parseSayCallback(data: string): { langCode: string; msgId: number } | null {
  const parts = data.split(":");
  if (parts.length !== 4) return null;
  const langCode = parts[2] ?? "";
  const msgId = Number.parseInt(parts[3] ?? "", 10);
  if (!langCode || !Number.isFinite(msgId)) return null;
  return { langCode, msgId };
}

export async function handlePronounceCallback(ctx: BotContext): Promise<void> {
  const parsed = parseSayCallback(ctx.callbackQuery?.data ?? "");
  if (!parsed) {
    await ctx.answerCallbackQuery();
    return;
  }
  const { langCode, msgId } = parsed;
  const entry = ctx.session.translationMap?.[String(msgId)];

  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  if (!entry) {
    await answerStaleCallback(ctx, { action: "tr:say", msgId, lang });
    return;
  }

  // Audio is the Pro-only feature — gate before any synthesis is even considered.
  if (!(await ensurePaidFeature(ctx, FEATURE_KEYS.pronunciation, lang))) {
    return;
  }

  // Not simply `translations[langCode]`: on a reverse-learning card the source
  // word is the headword above the translations and has no entry there at all.
  const text = resolvePronounceableText(entry.output, langCode, languageOrderFromSettings(settings));
  const config = await ctx.services.settings.getTtsConfig();

  // Re-check `enabled` at tap time, not just at render time: a card sent before an
  // admin turned TTS off still carries a live button.
  if (!config.enabled || !text) {
    await ctx.answerCallbackQuery({ text: t("ttsUnavailable", lang), show_alert: true });
    return;
  }

  const result = await playPronunciation(
    {
      text,
      langCode,
      modelId: config.modelId,
      voice: config.voice,
      maxChars: config.maxChars,
    },
    {
      cache: ctx.services.ttsCacheRepository,
      synthesize: (input) => ctx.services.ai.generateSpeech({ ...input, userId: ctx.user.id }),
      deliver: async (payload) => {
        const audio = "fileId" in payload ? payload.fileId : new InputFile(payload.bytes, `${langCode}.mp3`);
        // `sendVoice` accepts mp3 directly, so the bytes go through untranscoded.
        // Replying to the card keeps the audio anchored to the word it belongs to
        // when several cards are in flight.
        const sent = await ctx.replyWithVoice(audio, {
          reply_to_message_id: msgId,
          // Telegram gives a voice message no visible text of its own, so the
          // spoken word is captioned beside the player — a user scrolling back
          // can tell two pronunciations apart without replaying either.
          caption: text,
        });
        return sent.voice.file_id;
      },
    },
  );

  if (result.ok) {
    logEvent("card.tts_played", {
      lang: langCode,
      cached: result.cached,
      chars: result.charCount,
      generationId: result.generationId,
    });
    await ctx.answerCallbackQuery();
    return;
  }

  logEvent("card.tts_failed", { lang: langCode, reason: result.reason, word: text }, "error");
  const message = result.reason === "too_long" ? t("ttsTooLong", lang) : t("ttsUnavailable", lang);
  await ctx.answerCallbackQuery({ text: message, show_alert: true });
}
