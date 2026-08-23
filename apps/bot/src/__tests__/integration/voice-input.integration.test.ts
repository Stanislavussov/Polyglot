/**
 * Voice message → translation — grammY e2e integration test (Task 80).
 *
 * Drives a voice message through the real dispatcher: mode-router intercepts
 * `ctx.message.voice`, `handleVoiceMessage` gates it (STT config → paid feature →
 * duration cap → download → transcribe), and a successful transcript re-enters the
 * ordinary translate pipeline exactly like typed text. The refusal branches must
 * never reach the file API or the AI boundary — that is what `download`/`getFile`
 * call counts prove that a mock-only unit test cannot.
 *
 * Feature access (`voiceInput`) is real DB-backed (`plan_feature_access`), seeded
 * by `admin:seed` as part of `pnpm test:integration`'s bootstrap — the same plan
 * arrangement the pronunciation (`tts-pronunciation.integration.test.ts`) suite
 * relies on for its own Pro-only gate. `arrangeOnboardedTranslator(id, { plan })`
 * is therefore sufficient; no direct repository seeding is needed here.
 */
import { languageRepository, vocabularyRepository } from "@polyglot/adapter-db";
import { describe, expect, it, vi } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import {
  type BotHarness,
  callbackQueryUpdate,
  createBotHarness,
  FAKE_VOICE_AUDIO,
  lastRenderedCard,
  voiceMessageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";

const STT_MODEL = "openai/whisper-large-v3-turbo";
const STT_ENABLED = { enabled: true, modelId: STT_MODEL, maxDurationSec: 60 };

function transcribeMock(text: string) {
  return vi.fn().mockResolvedValue({ text, seconds: 2, costUsd: 0.0002, generationId: "gen-stt-test" });
}

const getFileCalls = (harness: BotHarness) => harness.sent.filter((c) => c.method === "getFile");
const downloadCalls = (harness: BotHarness) => harness.sent.filter((c) => c.method === "download");
const sendMessageCalls = (harness: BotHarness) => harness.sent.filter((c) => c.method === "sendMessage");

describe("voice message → translation (integration)", () => {
  it("transcribes a Pro user's voice message and renders a translation card", async () => {
    const transcribe = transcribeMock("hello");
    const harness = createBotHarness({
      ai: { ...deterministicTranslateAi(), transcribe },
      settings: { getSttConfig: vi.fn().mockResolvedValue(STT_ENABLED) },
    });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id, { plan: "pro" });

    await harness.dispatch(voiceMessageUpdate({ chatId: id, fromId: id, duration: 5 }));

    // The transcript re-enters the ordinary translate pipeline and renders a card.
    const { messageId: cardMsgId, buttons } = lastRenderedCard(harness.sent);
    expect(buttons).toContain(`tr:save:${cardMsgId}`);

    expect(getFileCalls(harness)).toHaveLength(1);
    expect(downloadCalls(harness)).toHaveLength(1);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe.mock.calls[0]![0]).toMatchObject({ format: "ogg", modelId: STT_MODEL, userId });
    expect(transcribe.mock.calls[0]![0].audio).toEqual(FAKE_VOICE_AUDIO);

    // Save the card and confirm the transcribed word (not literal audio) was persisted.
    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: cardMsgId, data: `tr:save:${cardMsgId}` }),
    );

    const en = await languageRepository.findByCode("en");
    if (!en) throw new Error("expected seeded language 'en'");
    const saved = await vocabularyRepository.findByOriginalAndSource(userId, "hello", en.id);
    expect(saved).not.toBeNull();
    expect(saved?.original).toBe("hello");
  });

  it("denies a Free user with the upgrade screen, calling neither the file API nor transcribe", async () => {
    const transcribe = transcribeMock("hello");
    const harness = createBotHarness({
      ai: { ...deterministicTranslateAi(), transcribe },
      settings: { getSttConfig: vi.fn().mockResolvedValue(STT_ENABLED) },
    });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id); // default plan: free

    await harness.dispatch(voiceMessageUpdate({ chatId: id, fromId: id, duration: 5 }));

    const reply = sendMessageCalls(harness).at(-1);
    expect(reply).toBeDefined();
    expect(String(reply?.payload.text)).toContain("Voice input");
    // Upgrade screen keyboard, not a translation card.
    expect(reply?.payload.reply_markup).toBeDefined();

    expect(getFileCalls(harness)).toHaveLength(0);
    expect(downloadCalls(harness)).toHaveLength(0);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("falls through to the text-only rejection while STT is disabled, with no AI calls", async () => {
    const transcribe = transcribeMock("hello");
    const harness = createBotHarness({
      ai: { ...deterministicTranslateAi(), transcribe },
      settings: { getSttConfig: vi.fn().mockResolvedValue({ ...STT_ENABLED, enabled: false }) },
    });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id, { plan: "pro" });

    await harness.dispatch(voiceMessageUpdate({ chatId: id, fromId: id, duration: 5 }));

    const reply = sendMessageCalls(harness).at(-1);
    expect(String(reply?.payload.text)).toContain("I work with text only");

    expect(getFileCalls(harness)).toHaveLength(0);
    expect(downloadCalls(harness)).toHaveLength(0);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("refuses an over-duration recording before downloading anything", async () => {
    const transcribe = transcribeMock("hello");
    const harness = createBotHarness({
      ai: { ...deterministicTranslateAi(), transcribe },
      settings: { getSttConfig: vi.fn().mockResolvedValue(STT_ENABLED) },
    });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id, { plan: "pro" });

    await harness.dispatch(voiceMessageUpdate({ chatId: id, fromId: id, duration: STT_ENABLED.maxDurationSec + 1 }));

    const reply = sendMessageCalls(harness).at(-1);
    expect(String(reply?.payload.text)).toContain(String(STT_ENABLED.maxDurationSec));
    expect(String(reply?.payload.text)).toContain("too long");

    expect(getFileCalls(harness)).toHaveLength(0);
    expect(downloadCalls(harness)).toHaveLength(0);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("replies with the transcription-failed message when transcribe rejects, and persists nothing", async () => {
    const transcribe = vi.fn().mockRejectedValue(new Error("upstream 500"));
    const harness = createBotHarness({
      ai: { ...deterministicTranslateAi(), transcribe },
      settings: { getSttConfig: vi.fn().mockResolvedValue(STT_ENABLED) },
    });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id, { plan: "pro" });

    await harness.dispatch(voiceMessageUpdate({ chatId: id, fromId: id, duration: 5 }));

    const reply = sendMessageCalls(harness).at(-1);
    expect(String(reply?.payload.text)).toContain("Couldn't recognize the voice message");

    // The failed attempt did reach the file API — only transcription itself failed.
    expect(getFileCalls(harness)).toHaveLength(1);
    expect(downloadCalls(harness)).toHaveLength(1);
    expect(transcribe).toHaveBeenCalledTimes(1);

    // No card rendered, and nothing persisted under the never-transcribed word.
    expect(harness.sent.some((c) => c.method === "editMessageReplyMarkup")).toBe(false);
    const en = await languageRepository.findByCode("en");
    if (!en) throw new Error("expected seeded language 'en'");
    const saved = await vocabularyRepository.findByOriginalAndSource(userId, "hello", en.id);
    expect(saved).toBeNull();
  });
});
