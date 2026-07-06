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
import { handleVideosCommand } from "../video-vocabulary.helper.js";

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
