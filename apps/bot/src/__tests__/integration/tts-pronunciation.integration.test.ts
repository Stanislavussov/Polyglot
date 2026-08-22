/**
 * Word pronunciation — grammY e2e integration test (Task 77).
 *
 * Drives `tr:say:<lang>:<msgId>` through the real dispatcher, the real DI
 * container and the real Postgres `tts_cache` table. Only two boundaries are
 * swapped: the AI (deterministic fixtures, as in every test in this lane) and the
 * TTS settings blob, overridden per-harness rather than written to
 * `system_settings` — that row is global and this lane runs two workers.
 *
 * What this pins down that a mock-only test cannot: that a second tap really costs
 * nothing (the row is found and re-sent, with no upload), and that a `file_id`
 * Telegram has stopped accepting heals itself instead of surfacing as an error.
 */
import { ttsCacheRepository } from "@polyglot/adapter-db";
import { hashTtsText } from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import {
  type BotHarness,
  callbackQueryUpdate,
  createBotHarness,
  lastRenderedCard,
  messageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";

const TTS_VOICE = "Kore";
const AUDIO = new Uint8Array([0x49, 0x44, 0x33, 0x04]);

/**
 * `tts_cache` is deliberately global — that is the feature — so tests must not
 * share a cache key or one test's row silently satisfies the next test's first
 * tap. The model id is part of the key, so giving each test its own is the
 * narrowest way to isolate them, and it doubles as a check that the key really
 * includes the model.
 */
let modelSeq = 0;
function uniqueTtsModel(): string {
  modelSeq += 1;
  return `test/tts-model-${process.pid}-${modelSeq}`;
}

function arrangeHarness(overrides: { enabled?: boolean } = {}) {
  const modelId = uniqueTtsModel();
  const tts = { enabled: overrides.enabled ?? true, modelId, voice: TTS_VOICE, maxChars: 200 };
  const generateSpeech = vi.fn().mockResolvedValue({ bytes: AUDIO, generationId: "gen-tts-test" });
  const harness = createBotHarness({
    ai: { ...deterministicTranslateAi(), generateSpeech },
    settings: { getTtsConfig: vi.fn().mockResolvedValue(tts) },
  });
  return { harness, generateSpeech, modelId };
}

/** Send a word and return the rendered card's message id and buttons. */
async function renderCard(harness: BotHarness, chatId: number, word: string) {
  await harness.dispatch(messageUpdate({ chatId, fromId: chatId, text: word }));
  return lastRenderedCard(harness.sent);
}

const voiceCalls = (harness: BotHarness) => harness.sent.filter((c) => c.method === "sendVoice");

/** The alert text on the callback answer, when the handler raised one. */
function callbackAlert(harness: BotHarness): string | undefined {
  const answers = harness.sent.filter((c) => c.method === "answerCallbackQuery");
  const text = answers.at(-1)?.payload.text;
  return typeof text === "string" ? text : undefined;
}

describe("word pronunciation (integration)", () => {
  it("offers a pronunciation button for the learning language and speaks it on tap", async () => {
    const { harness, generateSpeech, modelId } = arrangeHarness();
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id); // native en, learning cs

    const { messageId: cardMsgId, buttons } = await renderCard(harness, id, "hello");
    // Only the learning language gets a speaker — never the native one.
    expect(buttons).toContain(`tr:say:cs:${cardMsgId}`);
    expect(buttons).not.toContain(`tr:say:en:${cardMsgId}`);

    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: cardMsgId, data: `tr:say:cs:${cardMsgId}` }),
    );

    expect(generateSpeech).toHaveBeenCalledTimes(1);
    expect(generateSpeech.mock.calls[0]![0]).toMatchObject({ modelId, voice: TTS_VOICE });
    const spokenText = String(generateSpeech.mock.calls[0]![0].text);
    expect(spokenText.length).toBeGreaterThan(0);

    const voices = voiceCalls(harness);
    expect(voices).toHaveLength(1);
    expect(voices[0]!.isUpload).toBe(true); // fresh audio is uploaded as bytes
    expect(callbackAlert(harness)).toBeUndefined();

    // The synthesis is now cached under the exact text that was spoken.
    const cached = await ttsCacheRepository.find({
      text: spokenText,
      langCode: "cs",
      modelId,
      voice: TTS_VOICE,
    });
    expect(cached).not.toBeNull();
  });

  it("serves a second tap from the cache without paying for synthesis again", async () => {
    const { harness, generateSpeech, modelId } = arrangeHarness();
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);

    const { messageId: cardMsgId } = await renderCard(harness, id, "hello");
    const tap = () =>
      harness.dispatch(
        callbackQueryUpdate({ chatId: id, fromId: id, messageId: cardMsgId, data: `tr:say:cs:${cardMsgId}` }),
      );

    await tap();
    const firstFileId = (await currentCacheEntry(generateSpeech, modelId))!;
    harness.reset();

    await tap();

    // The whole point of the feature's economics: no second provider call.
    expect(generateSpeech).toHaveBeenCalledTimes(1);
    const voices = voiceCalls(harness);
    expect(voices).toHaveLength(1);
    // Re-sent by file_id in a JSON payload, not re-uploaded as bytes.
    expect(voices[0]!.isUpload).toBeUndefined();
    expect(voices[0]!.payload.voice).toBe(firstFileId);
  });

  it("heals a file_id Telegram no longer accepts instead of failing the tap", async () => {
    const { harness, generateSpeech } = arrangeHarness();
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);

    const { messageId: cardMsgId } = await renderCard(harness, id, "hello");
    const tap = () =>
      harness.dispatch(
        callbackQueryUpdate({ chatId: id, fromId: id, messageId: cardMsgId, data: `tr:say:cs:${cardMsgId}` }),
      );

    await tap();
    harness.reset();

    harness.failNextVoice();
    await tap();

    // One rejected re-send, then a fresh synthesis and a successful upload.
    expect(generateSpeech).toHaveBeenCalledTimes(2);
    const voices = voiceCalls(harness);
    expect(voices).toHaveLength(2);
    expect(voices[1]!.isUpload).toBe(true);
    // The user is never told about the stale entry — they just hear the word.
    expect(callbackAlert(harness)).toBeUndefined();
  });

  it("renders no pronunciation button at all while TTS is disabled", async () => {
    const { harness, generateSpeech } = arrangeHarness({ enabled: false });
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);

    const { buttons } = await renderCard(harness, id, "hello");

    expect(buttons.some((b) => b.startsWith("tr:say:"))).toBe(false);
    expect(generateSpeech).not.toHaveBeenCalled();
  });

  it("tells the user the card expired when the session entry is gone", async () => {
    const { harness, generateSpeech } = arrangeHarness();
    const id = uniqueTelegramId();
    await arrangeOnboardedTranslator(id);

    // A message id that never carried a card — the "session expired" report shape.
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: 999_999, data: "tr:say:cs:999999" }),
    );

    expect(generateSpeech).not.toHaveBeenCalled();
    expect(voiceCalls(harness)).toHaveLength(0);
    expect(callbackAlert(harness)).toBeTruthy();
  });
});

/** The file_id stored for whatever text the (single) synthesis call was given. */
async function currentCacheEntry(generateSpeech: ReturnType<typeof vi.fn>, modelId: string): Promise<string | null> {
  const text = String(generateSpeech.mock.calls[0]![0].text);
  // Sanity-check the digest helper agrees with what the repository keyed on.
  expect(hashTtsText(text)).toHaveLength(64);
  const hit = await ttsCacheRepository.find({ text, langCode: "cs", modelId, voice: TTS_VOICE });
  return hit?.telegramFileId ?? null;
}
