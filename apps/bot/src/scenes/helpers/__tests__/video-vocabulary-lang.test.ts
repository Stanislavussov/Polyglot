/**
 * Behavioral tests for interface-language resolution in the video vocabulary feature.
 *
 * Regression guard: the video feature previously read `ctx.user.settings`, which is
 * never populated by any middleware, so its entire UI always rendered in English.
 * The fix resolves the interface language from persisted settings via
 * `ctx.services.userRepository.getSettings`, exactly like the rest of the bot.
 * These tests drive `handleVideosCommand` end-to-end and assert on the rendered
 * language of the reply — the observable behavior — rather than internal calls.
 */
import type { ServiceContainer } from "@polyglot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServicesStub } from "../../../test-helpers/services-stub.js";
import type { BotContext } from "../../../types.js";
import { handleVideoSavePhraseCallback, handleVideosCommand } from "../video-vocabulary.helper.js";

const mockGetSettings = vi.fn();
const mockFindProcessesByUser = vi.fn();
const mockCountProcessesByUser = vi.fn();

function createMockCtx() {
  const reply = vi.fn().mockResolvedValue({ message_id: 1 });
  const ctx = {
    user: { id: 1, audienceGroup: "public" },
    session: {},
    reply,
    services: createServicesStub({
      userRepository: {
        getSettings: (...args: unknown[]) => mockGetSettings(...args),
      } as unknown as ServiceContainer["userRepository"],
      videoVocabularyRepository: {
        findProcessesByUser: (...args: unknown[]) => mockFindProcessesByUser(...args),
        countProcessesByUser: (...args: unknown[]) => mockCountProcessesByUser(...args),
      } as unknown as ServiceContainer["videoVocabularyRepository"],
    }),
  } as unknown as BotContext & { reply: ReturnType<typeof vi.fn> };
  return ctx;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindProcessesByUser.mockResolvedValue([]);
  mockCountProcessesByUser.mockResolvedValue(0);
});

describe("handleVideosCommand — interface language resolution", () => {
  it("renders the video UI in the user's persisted interfaceLang (ru)", async () => {
    mockGetSettings.mockResolvedValue({ interfaceLang: "ru" });
    const ctx = createMockCtx();

    await handleVideosCommand(ctx);

    expect(mockGetSettings).toHaveBeenCalledWith(1);
    const replyText = ctx.reply.mock.calls[0][0] as string;
    // Russian rendering of `videoNoVideos` — proves the feature reads interfaceLang from getSettings.
    expect(replyText).toContain("Видео ещё не обработаны");
    // Must NOT fall back to the English rendering.
    expect(replyText).not.toContain("No videos processed yet");
  });

  it("falls back to English when interfaceLang is absent", async () => {
    mockGetSettings.mockResolvedValue({ interfaceLang: null });
    const ctx = createMockCtx();

    await handleVideosCommand(ctx);

    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain("No videos processed yet");
  });

  it("falls back to English when settings are missing entirely", async () => {
    mockGetSettings.mockResolvedValue(null);
    const ctx = createMockCtx();

    await handleVideosCommand(ctx);

    const replyText = ctx.reply.mock.calls[0][0] as string;
    expect(replyText).toContain("No videos processed yet");
  });
});

/**
 * Regression guard for the second half of the video fix: saving a phrase used to
 * read the native language from `ctx.user?.settings?.nativeLang` (always
 * undefined), so the native-language translation was silently dropped from the
 * saved vocabulary entry. It now reads `nativeLang` from persisted settings via
 * `getSettings`. This drives `handleVideoSavePhraseCallback` and asserts the
 * created entry carries the native translation — the observable behavior.
 */
describe("handleVideoSavePhraseCallback — native translation attachment", () => {
  const mockCreate = vi.fn();
  const mockGetLang = vi.fn((code: string) => ({ id: code === "ru" ? 2 : 1, code }));

  function createSaveCtx(settings: { nativeLang: string | null } | null) {
    const services = createServicesStub({
      userRepository: {
        getSettings: vi.fn().mockResolvedValue(settings),
      } as unknown as ServiceContainer["userRepository"],
      languageCache: {
        getLang: mockGetLang,
      } as unknown as ServiceContainer["languageCache"],
      vocabularyRepository: {
        findByOriginalAndSource: vi.fn().mockResolvedValue(undefined),
        create: mockCreate.mockResolvedValue({ id: 100 }),
      } as unknown as ServiceContainer["vocabularyRepository"],
      vocabularyDictionaryRepository: {
        addEntryToDefault: vi.fn().mockResolvedValue(undefined),
      } as unknown as ServiceContainer["vocabularyDictionaryRepository"],
      videoVocabularyRepository: {
        findPhraseById: vi.fn().mockResolvedValue({
          id: 7,
          videoProcessId: 3,
          phrase: "hola",
          phraseType: "word",
          nativeTranslation: "привет",
          context: "Hola, ¿qué tal?",
          emoji: "👋",
          timestampSeconds: 12,
          sortOrder: 1,
          savedEntryId: null,
        }),
        findProcessById: vi.fn().mockResolvedValue({
          id: 3,
          userId: 1,
          language: "es",
          videoUrl: "https://youtu.be/x",
          title: "Clip",
        }),
        findPhrasesByProcess: vi.fn().mockResolvedValue([]),
        countPhrasesByProcess: vi.fn().mockResolvedValue(0),
        markPhraseSaved: vi.fn().mockResolvedValue(undefined),
      } as unknown as ServiceContainer["videoVocabularyRepository"],
    });

    return {
      user: { id: 1, audienceGroup: "public" },
      session: {},
      callbackQuery: { data: "video:save:7" },
      answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
      editMessageText: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue({ message_id: 1 }),
      services,
    } as unknown as BotContext;
  }

  beforeEach(() => {
    mockCreate.mockClear();
    mockGetLang.mockClear();
  });

  it("attaches the native-language translation using the persisted nativeLang", async () => {
    const ctx = createSaveCtx({ nativeLang: "ru" });

    await handleVideoSavePhraseCallback(ctx);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const createArg = mockCreate.mock.calls[0][1] as { translations: Array<{ targetLangId: number; text: string }> };
    // Native (ru, id 2) translation must be present — the exact regression that
    // was dropped when nativeLang came from the always-undefined ctx.user.settings.
    expect(createArg.translations).toEqual([expect.objectContaining({ targetLangId: 2, text: "привет" })]);
  });

  it("saves no native translation when the user has no nativeLang", async () => {
    const ctx = createSaveCtx({ nativeLang: null });

    await handleVideoSavePhraseCallback(ctx);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const createArg = mockCreate.mock.calls[0][1] as { translations: unknown[] };
    expect(createArg.translations).toEqual([]);
  });
});
