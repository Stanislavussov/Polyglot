/**
 * Voice message → translation (Task 80).
 *
 * A voice message is just another way of typing a word, so once the audio is
 * transcribed it re-enters the ordinary text pipeline via `handleTranslateText`
 * — there is no separate "voice card". Everything before that is refusal
 * policy, ordered cheapest-first: a disabled feature falls through untouched,
 * a plan without the feature never reaches Telegram's file API, and an
 * over-long recording is refused before a byte is downloaded.
 */
import { errorFields, FEATURE_KEYS, isSupported, logEvent, type SupportedLang, t } from "@polyglot/core";
import { getRequestSettings } from "../../middlewares/request-settings.js";
import type { BotContext } from "../../types.js";
import { sendTypingIndicator } from "../../utils/long-op.js";
import { replyTechnical } from "../../utils/message-cleanup.js";
import { downloadTelegramFile } from "../../utils/telegram-file.js";
import { ensurePaidFeatureForMessage } from "./paid-feature.helper.js";
import { handleTranslateText } from "./translate-flow.js";

/**
 * Returns `true` when the update was consumed. `false` means "not a voice
 * message, or speech-to-text is switched off" — the caller must then apply its
 * own non-text handling, so turning the feature off restores the old behavior
 * exactly.
 */
export async function handleVoiceMessage(ctx: BotContext): Promise<boolean> {
  const voice = ctx.message?.voice;
  if (!voice) return false;

  const stt = await ctx.services.settings.getSttConfig();
  // An empty model id means the same as disabled — there is nothing to call.
  if (!stt.enabled || !stt.modelId.trim()) return false;

  const settings = await getRequestSettings(ctx, ctx.user.id);
  const rawLang = settings?.interfaceLang ?? "en";
  const lang: SupportedLang = isSupported(rawLang) ? rawLang : "en";

  if (!(await ensurePaidFeatureForMessage(ctx, FEATURE_KEYS.voiceInput, lang))) {
    return true;
  }

  if (voice.duration > stt.maxDurationSec) {
    logEvent("voice.too_long", { durationSec: voice.duration, maxDurationSec: stt.maxDurationSec });
    await replyTechnical(ctx, t("voiceTooLong", lang, { max: String(stt.maxDurationSec) }));
    return true;
  }

  sendTypingIndicator(ctx);

  let text: string;
  let generationId: string | null;
  try {
    const audio = await downloadTelegramFile(ctx.api, voice.file_id);
    const result = await ctx.services.ai.transcribe({
      audio,
      format: "ogg",
      modelId: stt.modelId,
      userId: ctx.user.id,
    });
    text = result.text.trim();
    generationId = result.generationId;
  } catch (err) {
    logEvent("voice.transcribe_failed", { durationSec: voice.duration, ...errorFields(err) }, "error");
    await replyTechnical(ctx, t("voiceTranscriptionFailed", lang));
    return true;
  }

  if (!text) {
    logEvent("voice.transcribe_empty", { durationSec: voice.duration });
    await replyTechnical(ctx, t("voiceTranscriptionFailed", lang));
    return true;
  }

  logEvent("voice.transcribed", { durationSec: voice.duration, chars: text.length, generationId });
  await handleTranslateText(ctx, text);
  return true;
}
