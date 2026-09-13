/**
 * Video vocabulary flow — grammY e2e integration test.
 *
 * Covers the incident where every video failed with "No transcript available in
 * language ru": the process language is only a guess from user settings, so the
 * transcript fetch may come back in a different (real) caption language. The flow
 * must complete anyway, persist the detected language on the process, and run
 * extraction against it — not against the guess.
 *
 * The YouTube adapter is the network boundary here (no DI seam like `services.ai`),
 * so `fetchMetadata`/`fetchTranscript` are module-mocked; everything else — the
 * dispatcher, quota billing, Postgres persistence, the confirmation dialog — is real.
 */
import { botSessionRepository, getLang, videoVocabularyRepository, vocabularyRepository } from "@polyglot/adapter-db";
import { fetchMetadata, fetchTranscript, TranscriptNotAvailableError } from "@polyglot/adapter-youtube";
import type { AIPort } from "@polyglot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import {
  type BotHarness,
  type CapturedCall,
  callbackQueryUpdate,
  createBotHarness,
  messageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";

vi.mock("@polyglot/adapter-youtube", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@polyglot/adapter-youtube")>()),
  fetchMetadata: vi.fn(),
  fetchTranscript: vi.fn(),
}));

const metadataMock = vi.mocked(fetchMetadata);
const transcriptMock = vi.mocked(fetchTranscript);

beforeEach(() => {
  metadataMock.mockReset();
  transcriptMock.mockReset();
});

/** An 11-character id every YouTube URL pattern accepts, unique per test. */
function uniqueVideoId(): string {
  return String(uniqueTelegramId()).slice(-11).padStart(11, "0");
}

const EN_TRANSCRIPT = {
  text: "hello world nice phrase",
  segments: [
    { text: "hello world", offset: 0, duration: 5 },
    { text: "nice phrase", offset: 6, duration: 4 },
  ],
  type: "auto-generated" as const,
  language: "en",
};

const EXTRACTED = {
  phrases: [
    {
      phrase: "nice phrase",
      nativeTranslation: "pěkná fráze",
      emoji: "✨",
      type: "phrase",
      level: "B1",
      context: "what a nice phrase",
      timestampSeconds: 6,
    },
  ],
};

/**
 * The extraction fixture first; every other schema falls through to the translate
 * fixtures, so a saved phrase can run the real enrichment path.
 */
function videoAndTranslateAi(): Partial<AIPort> {
  const translate = deterministicTranslateAi();
  const generateObject: AIPort["generateObject"] = async (prompt, schema, model, options) => {
    const parsed = schema.safeParse(EXTRACTED);
    if (parsed.success) return parsed.data;
    if (!translate.generateObject) throw new Error("translate mock lost its generateObject");
    return translate.generateObject(prompt, schema, model, options);
  };
  return { ...translate, generateObject };
}

function arrangeHarness() {
  const generateObject = vi.fn().mockResolvedValue(EXTRACTED);
  const harness = createBotHarness({
    ai: { generateObject },
    settings: {
      getVideoVocabularyConfig: vi
        .fn()
        .mockResolvedValue({ monthlyLimit: 10, minPhrases: 1, maxPhrases: 5, extractionModelId: "test/extract" }),
    },
  });
  return { harness, generateObject };
}

const sentMessages = (harness: BotHarness): CapturedCall[] =>
  harness.sent.filter((call) => call.method === "sendMessage");

function confirmButton(harness: BotHarness): { messageId: number; data: string } {
  for (const call of harness.sent) {
    if (call.method !== "sendMessage") continue;
    const markup = call.payload.reply_markup as
      | { inline_keyboard?: Array<Array<{ callback_data?: string }>> }
      | undefined;
    const data = (markup?.inline_keyboard ?? [])
      .flat()
      .map((button) => button.callback_data)
      .find((d) => d?.startsWith("vid:confirm:"));
    if (data && call.messageId) return { messageId: call.messageId, data };
  }
  const replies = harness.sent.map((call) => `${call.method}: ${String(call.payload.text ?? "")}`).join(" | ");
  throw new Error(`no vid:confirm button was rendered; bot sent: ${replies || "(nothing)"}`);
}

describe("video vocabulary flow (integration)", () => {
  it("completes a video whose transcript falls back to another language and persists the detected one", async () => {
    // Arrange — learner set up so the language guess ("cs") differs from the real caption track ("en").
    const { harness, generateObject } = arrangeHarness();
    const id = uniqueTelegramId();
    // native en, learning cs; video access needs a paid plan
    const userId = await arrangeOnboardedTranslator(id, { plan: "plus" });
    const videoId = uniqueVideoId();
    metadataMock.mockResolvedValue({ videoId, title: "Test video", durationSeconds: 0 });
    transcriptMock.mockResolvedValue(EN_TRANSCRIPT);

    // Act — send the URL, get the confirmation card.
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: `https://youtu.be/${videoId}` }));

    // Assert — process reserved with the guessed language, confirmation offered.
    const pending = await videoVocabularyRepository.findProcessByUserAndVideo(userId, videoId);
    expect(pending?.status).toBe("pending");
    expect(pending?.language).toBe("cs");
    const { messageId, data } = confirmButton(harness);
    expect(data).toBe(`vid:confirm:${pending?.id}`);

    // Cleanup between acts.
    harness.reset();

    // Act — confirm; processing runs fire-and-forget, so wait on the DB state.
    await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId, data }));
    await vi.waitFor(
      async () => {
        const row = await videoVocabularyRepository.findProcessById(pending?.id ?? 0);
        expect(row?.status).toBe("completed");
      },
      { timeout: 5000 },
    );

    // Assert — the triad: DB refined to the detected language, phrases saved, completion reply sent.
    const completed = await videoVocabularyRepository.findProcessById(pending?.id ?? 0);
    expect(completed?.language).toBe("en");
    expect(transcriptMock).toHaveBeenCalledWith(videoId, "cs");
    const cached = await videoVocabularyRepository.findCachedTranscript(videoId, "en");
    expect(cached?.transcript).toContain("nice phrase");
    const phrases = await videoVocabularyRepository.findPhrasesByProcess(completed?.id ?? 0);
    expect(phrases.map((p) => p.phrase)).toEqual(["nice phrase"]);
    // Extraction must run against the real transcript language, not the guess.
    expect(generateObject).toHaveBeenCalledTimes(1);
    const prompt = String(generateObject.mock.calls[0]?.[0]);
    expect(prompt).toContain("transcript in en");
    expect(prompt).not.toContain("transcript in cs");
    const done = sentMessages(harness).at(-1);
    expect(String(done?.payload.text)).toContain("✅");
    const session = await botSessionRepository.get(String(id));
    expect(session).toBeDefined(); // flow keeps no FSM state — session must survive untouched
  });

  it("fails the process once, without retries, when no transcript exists at all", async () => {
    // Arrange
    const { harness, generateObject } = arrangeHarness();
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id, { plan: "plus" });
    const videoId = uniqueVideoId();
    metadataMock.mockResolvedValue({ videoId, title: "Silent video", durationSeconds: 0 });
    transcriptMock.mockRejectedValue(new TranscriptNotAvailableError(videoId));

    // Act
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: `https://youtu.be/${videoId}` }));
    const { messageId, data } = confirmButton(harness);
    harness.reset();
    await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId, data }));
    await vi.waitFor(
      async () => {
        const row = await videoVocabularyRepository.findProcessByUserAndVideo(userId, videoId);
        expect(row?.status).toBe("failed");
      },
      { timeout: 5000 },
    );

    // Assert — one attempt (transcript errors never resolve), error recorded, user told.
    expect(transcriptMock).toHaveBeenCalledTimes(1);
    expect(generateObject).not.toHaveBeenCalled();
    const failed = await videoVocabularyRepository.findProcessByUserAndVideo(userId, videoId);
    expect(failed?.errorMessage).toContain("No transcript available");
    const notice = sentMessages(harness).at(-1);
    expect(String(notice?.payload.text)).toContain("❌");
  });

  /**
   * Regression: a phrase saved from a video came back from background enrichment
   * carrying only Czech. The enrichment asked for the learning languages minus the
   * source and left the native language out, and `updateAllTranslations` deletes
   * rows for languages absent from the request — so the Russian translation the
   * save had just written was erased, and the card fell back to showing its stored
   * description where the answer belongs.
   */
  it("keeps the native translation on a saved phrase after background enrichment", async () => {
    // Arrange — the reported learner: ru native, learning cs+en, English video.
    const harness = createBotHarness({
      ai: videoAndTranslateAi(),
      settings: {
        getVideoVocabularyConfig: vi
          .fn()
          .mockResolvedValue({ monthlyLimit: 10, minPhrases: 1, maxPhrases: 5, extractionModelId: "test/extract" }),
      },
    });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id, {
      nativeLang: "ru",
      learningLangs: ["cs", "en"],
      plan: "plus",
    });
    const videoId = uniqueVideoId();
    metadataMock.mockResolvedValue({ videoId, title: "Test video", durationSeconds: 0 });
    transcriptMock.mockResolvedValue(EN_TRANSCRIPT);

    // Act — URL → confirm → wait for the phrases to land.
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: `https://youtu.be/${videoId}` }));
    const { messageId, data } = confirmButton(harness);
    harness.reset();
    await harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId, data }));
    const processId = Number(data.split(":")[2]);
    await vi.waitFor(
      async () => {
        const row = await videoVocabularyRepository.findProcessById(processId);
        expect(row?.status).toBe("completed");
      },
      { timeout: 5000 },
    );

    // Act — browse the phrases and save the one that was extracted.
    const done = sentMessages(harness).at(-1);
    harness.reset();
    await harness.dispatch(
      callbackQueryUpdate({
        chatId: id,
        fromId: id,
        messageId: done?.messageId ?? 1,
        data: `vid:browse:${processId}:1`,
      }),
    );
    const phrases = await videoVocabularyRepository.findPhrasesByProcess(processId);
    const phraseId = phrases[0]?.id;
    expect(phraseId).toBeDefined();
    await harness.dispatch(
      callbackQueryUpdate({ chatId: id, fromId: id, messageId: done?.messageId ?? 1, data: `vid:save:${phraseId}` }),
    );

    // Assert — enrichment is fire-and-forget, so wait for it to have run, then
    // read the languages that survived it.
    const english = getLang("en");
    if (!english) throw new Error("language cache is not loaded (en missing)");
    await vi.waitFor(
      async () => {
        const entry = await vocabularyRepository.findByOriginalAndSource(userId, "nice phrase", english.id);
        expect(entry?.translations.length).toBeGreaterThan(1);
      },
      { timeout: 5000 },
    );

    const entry = await vocabularyRepository.findByOriginalAndSource(userId, "nice phrase", english.id);
    const byId = new Map(["ru", "cs", "en"].map((code) => [getLang(code)?.id, code]));
    const codes = (entry?.translations ?? []).map((translation) => byId.get(translation.targetLangId));
    expect(codes).toContain("ru");
    expect(codes).toContain("cs");
    // The source language is never one of the card's answers.
    expect(codes).not.toContain("en");
  });
});
