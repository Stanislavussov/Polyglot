/**
 * Tests for dictionary callback handlers.
 */
import type { VocabularyEntryWithTranslations } from "@polyglot/adapter-db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotContext } from "../../../types.js";

/* ── Mocks ─────────────────────────────────────────────────────── */

const mockGetSettings = vi.fn();
const mockCountByUser = vi.fn();
const mockFindByUserPaginated = vi.fn();
const mockFindById = vi.fn();
const mockHardDelete = vi.fn();
const mockGetAllLangs = vi.fn();

vi.mock("@polyglot/adapter-db", () => ({
  userRepository: { getSettings: (...args: unknown[]) => mockGetSettings(...args) },
  vocabularyRepository: {
    countByUser: (...args: unknown[]) => mockCountByUser(...args),
    findByUserPaginated: (...args: unknown[]) => mockFindByUserPaginated(...args),
    findById: (...args: unknown[]) => mockFindById(...args),
    hardDelete: (...args: unknown[]) => mockHardDelete(...args),
  },
  getAllLangs: () => mockGetAllLangs(),
}));

vi.mock("@polyglot/infra", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return {
    ...actual,
    getLangFlag: vi.fn((code: string) => {
      const m: Record<string, string> = { en: "🇬🇧", cs: "🇨🇿", ru: "🇷🇺" };
      return m[code];
    }),
  };
});

import {
  handleDictClose,
  handleDictConfirmDelete,
  handleDictDelete,
  handleDictNoop,
  handleDictPage,
  handleDictView,
} from "../dictionary.helper.js";

/* ── Helpers ───────────────────────────────────────────────────── */

function makeEntry(id: number, original: string): VocabularyEntryWithTranslations {
  return {
    id,
    userId: 1,
    original,
    sourceLangId: 1,
    inputType: "word",
    emoji: "🍎",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    translations: [
      {
        id: id * 10,
        entryId: id,
        targetLangId: 2,
        text: `translation-${id}`,
        transcription: null,
        expressionType: null,
        equivalentNote: null,
        connotationWarning: null,
        details: null,
        srsEaseFactor: 2.5,
        srsInterval: 0,
        srsDueDate: null,
        srsReviewCount: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  };
}

function createMockCtx(
  opts: { callbackData?: string; dictionary?: { currentPage: number; msgId?: number } | undefined } = {},
) {
  return {
    user: { id: 1 },
    session: {
      dictionary: "dictionary" in opts ? opts.dictionary : { currentPage: 1 },
    },
    callbackQuery: opts.callbackData ? { data: opts.callbackData, message: { message_id: 100 } } : undefined,
    editMessageText: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  } as unknown as BotContext & {
    editMessageText: ReturnType<typeof vi.fn>;
    deleteMessage: ReturnType<typeof vi.fn>;
    answerCallbackQuery: ReturnType<typeof vi.fn>;
  };
}

/* ── Setup ─────────────────────────────────────────────────────── */

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSettings.mockResolvedValue({ interfaceLang: "en" });
  mockGetAllLangs.mockReturnValue([
    { id: 1, code: "en" },
    { id: 2, code: "cs" },
    { id: 3, code: "ru" },
  ]);
});

/* ── handleDictPage ────────────────────────────────────────────── */

describe("handleDictPage", () => {
  it("calls findByUserPaginated with correct offset", async () => {
    const entries = [makeEntry(1, "word1")];
    mockCountByUser.mockResolvedValue(20);
    mockFindByUserPaginated.mockResolvedValue(entries);
    const ctx = createMockCtx({ callbackData: "dict:page:2" });

    await handleDictPage(ctx);

    expect(mockFindByUserPaginated).toHaveBeenCalledWith(1, 15, 15);
    expect(ctx.editMessageText).toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it("updates session currentPage", async () => {
    mockCountByUser.mockResolvedValue(20);
    mockFindByUserPaginated.mockResolvedValue([makeEntry(1, "w")]);
    const ctx = createMockCtx({ callbackData: "dict:page:2" });

    await handleDictPage(ctx);

    expect(ctx.session.dictionary?.currentPage).toBe(2);
  });

  it("shows emptyDictionary when total is 0", async () => {
    mockCountByUser.mockResolvedValue(0);
    const ctx = createMockCtx({ callbackData: "dict:page:1" });

    await handleDictPage(ctx);

    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining("empty"),
      expect.objectContaining({ reply_markup: undefined }),
    );
    expect(ctx.session.dictionary).toBeUndefined();
  });
});

/* ── handleDictView ────────────────────────────────────────────── */

describe("handleDictView", () => {
  it("calls findById and edits message with entry view", async () => {
    const entry = makeEntry(42, "hello");
    mockFindById.mockResolvedValue(entry);
    const ctx = createMockCtx({ callbackData: "dict:view:42" });

    await handleDictView(ctx);

    expect(mockFindById).toHaveBeenCalledWith(42);
    expect(ctx.editMessageText).toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it("shows noResults when entry not found", async () => {
    mockFindById.mockResolvedValue(null);
    const ctx = createMockCtx({ callbackData: "dict:view:999" });

    await handleDictView(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("No results") }),
    );
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });

  it("uses page from callback data when provided", async () => {
    const entry = makeEntry(42, "hello");
    mockFindById.mockResolvedValue(entry);
    const ctx = createMockCtx({ callbackData: "dict:view:42:3" });

    await handleDictView(ctx);

    // The keyboard should use page 3 for the back button
    const editCall = ctx.editMessageText.mock.calls[0];
    const keyboard = editCall[1].reply_markup;
    // Check that the back button goes to page 3
    const backRow = keyboard.inline_keyboard[1];
    expect(backRow[0].callback_data).toBe("dict:page:3");
  });
});

/* ── handleDictDelete ──────────────────────────────────────────── */

describe("handleDictDelete", () => {
  it("shows confirmation with word name", async () => {
    const entry = makeEntry(42, "hello");
    mockFindById.mockResolvedValue(entry);
    const ctx = createMockCtx({ callbackData: "dict:delete:42:1" });

    await handleDictDelete(ctx);

    expect(ctx.editMessageText).toHaveBeenCalledWith(expect.stringContaining("hello"), expect.any(Object));
  });

  it("shows noResults when entry not found", async () => {
    mockFindById.mockResolvedValue(null);
    const ctx = createMockCtx({ callbackData: "dict:delete:999" });

    await handleDictDelete(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("No results") }),
    );
  });
});

/* ── handleDictConfirmDelete ───────────────────────────────────── */

describe("handleDictConfirmDelete", () => {
  it("calls hardDelete and returns to list", async () => {
    mockFindById.mockResolvedValue(makeEntry(42, "hello"));
    mockHardDelete.mockResolvedValue(undefined);
    mockCountByUser.mockResolvedValue(5);
    mockFindByUserPaginated.mockResolvedValue([makeEntry(2, "remaining")]);
    const ctx = createMockCtx({ callbackData: "dict:confirm-delete:42:1" });

    await handleDictConfirmDelete(ctx);

    expect(mockHardDelete).toHaveBeenCalledWith(42);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining("deleted") }),
    );
    expect(ctx.editMessageText).toHaveBeenCalled();
  });

  it("goes to previous page when current page becomes empty", async () => {
    mockFindById.mockResolvedValue(makeEntry(42, "hello"));
    mockHardDelete.mockResolvedValue(undefined);
    // After deletion, only 15 entries left → 1 page, but we're on page 2
    mockCountByUser.mockResolvedValue(15);
    mockFindByUserPaginated.mockResolvedValue([makeEntry(1, "word")]);
    const ctx = createMockCtx({ callbackData: "dict:confirm-delete:42:2" });

    await handleDictConfirmDelete(ctx);

    // Should go to page 1 (totalPages = 1 < page 2)
    expect(mockFindByUserPaginated).toHaveBeenCalledWith(1, 0, 15);
    expect(ctx.session.dictionary?.currentPage).toBe(1);
  });

  it("shows emptyDictionary when last word deleted", async () => {
    mockFindById.mockResolvedValue(makeEntry(42, "hello"));
    mockHardDelete.mockResolvedValue(undefined);
    mockCountByUser.mockResolvedValue(0);
    const ctx = createMockCtx({ callbackData: "dict:confirm-delete:42:1" });

    await handleDictConfirmDelete(ctx);

    expect(ctx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining("empty"),
      expect.objectContaining({ reply_markup: undefined }),
    );
    expect(ctx.session.dictionary).toBeUndefined();
  });
});

/* ── handleDictClose ───────────────────────────────────────────── */

describe("handleDictClose", () => {
  it("deletes message and clears session", async () => {
    const ctx = createMockCtx();

    await handleDictClose(ctx);

    expect(ctx.deleteMessage).toHaveBeenCalled();
    expect(ctx.session.dictionary).toBeUndefined();
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
  });
});

/* ── handleDictNoop ────────────────────────────────────────────── */

describe("handleDictNoop", () => {
  it("answers callback query with no parameters", async () => {
    const ctx = createMockCtx();

    await handleDictNoop(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
  });
});

/* ── Restart recovery and ownership ────────────────────────────── */

describe("restart recovery and ownership", () => {
  it("handleDictPage re-renders from DB when session is missing", async () => {
    mockCountByUser.mockResolvedValue(20);
    mockFindByUserPaginated.mockResolvedValue([makeEntry(1, "w")]);
    const ctx = createMockCtx({ callbackData: "dict:page:2", dictionary: undefined });

    await handleDictPage(ctx);

    expect(mockFindByUserPaginated).toHaveBeenCalledWith(1, 15, 15);
    expect(ctx.editMessageText).toHaveBeenCalled();
    expect(ctx.session.dictionary?.currentPage).toBe(2);
  });

  it("handleDictView re-renders owned entries when session is missing", async () => {
    mockFindById.mockResolvedValue(makeEntry(42, "hello"));
    const ctx = createMockCtx({ callbackData: "dict:view:42:3", dictionary: undefined });

    await handleDictView(ctx);

    expect(ctx.editMessageText).toHaveBeenCalled();
    expect(ctx.session.dictionary?.currentPage).toBe(3);
  });

  it("handleDictDelete rejects entries owned by another user", async () => {
    mockFindById.mockResolvedValue({ ...makeEntry(42, "hello"), userId: 2 });
    const ctx = createMockCtx({ callbackData: "dict:delete:42:1", dictionary: undefined });

    await handleDictDelete(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("No results"),
      }),
    );
    expect(ctx.editMessageText).not.toHaveBeenCalled();
  });

  it("handleDictConfirmDelete validates ownership before deleting", async () => {
    mockFindById.mockResolvedValue({ ...makeEntry(42, "hello"), userId: 2 });
    const ctx = createMockCtx({ callbackData: "dict:confirm-delete:42:1", dictionary: undefined });

    await handleDictConfirmDelete(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("No results"),
      }),
    );
    expect(mockHardDelete).not.toHaveBeenCalled();
  });
});
