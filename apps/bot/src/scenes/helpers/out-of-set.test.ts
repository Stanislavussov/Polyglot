/**
 * Tests for the doubtful-source override callback (tr:srclang:<code>:<mid>).
 *
 * The handler recovers the original text from the card's session entry, forces
 * the tapped source language, and hands off to the mistype-confirm pipeline
 * (which sends a NEW card). These tests verify the routing/guards without
 * exercising the full translation pipeline — that is mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { error: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}));

vi.mock("@polyglot/core", () => ({
  t: vi.fn((key: string) => `[${key}]`),
  isSupported: vi.fn(() => true),
  isSupportedLanguage: vi.fn(() => true),
  resolveDirectionFromSource: vi.fn(),
  logEvent: vi.fn(),
  logger: mockLogger,
}));

vi.mock("../../middlewares/request-settings.js", () => ({
  clearRequestSettings: vi.fn(),
  getRequestSettings: vi.fn().mockResolvedValue({ interfaceLang: "en" }),
}));
vi.mock("./edit-message.helper.js", () => ({ editMessageReplyMarkupOrIgnore: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./translate-mode.shared.js", () => ({
  clearPendingClarification: vi.fn(),
  getUserLanguageGroup: (native: string, learning: string[]) => [native, ...learning],
  normalizeLearningLangs: (native: string, learning: string[]) => learning.filter((c) => c !== native),
}));
vi.mock("./translate-flow.js", () => ({ handleMistypeConfirmCallback: vi.fn().mockResolvedValue(undefined) }));

import { resolveDirectionFromSource } from "@polyglot/core";
import type { BotContext } from "../../types.js";
import { handleSrcLangOverrideCallback } from "./out-of-set.js";
import { handleMistypeConfirmCallback } from "./translate-flow.js";

function createCtx(overrides: { data?: string; entryOriginal?: string | null } = {}): BotContext {
  const translationMap =
    overrides.entryOriginal === null
      ? {}
      : {
          "42": {
            output: { original: overrides.entryOriginal ?? "pero", sourceLang: "cs", translations: {} },
            inputType: "word" as const,
            contextHint: "sport",
          },
        };
  return {
    callbackQuery: { id: "cbq", data: overrides.data ?? "tr:srclang:es:42" },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    session: { activeMode: "translate", translationMap },
    user: { id: 1 },
    services: {
      userRepository: {
        getSettings: vi.fn().mockResolvedValue({ interfaceLang: "en", nativeLang: "ru", learningLangs: ["cs", "es"] }),
      },
      languageDetectionRepository: { record: vi.fn().mockResolvedValue(undefined) },
    },
  } as unknown as BotContext;
}

describe("handleSrcLangOverrideCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveDirectionFromSource).mockReturnValue({
      sourceLang: "es",
      targetLangs: ["ru"],
      detectedLang: "es",
    });
  });

  it("forces the tapped source and hands off to the retranslation pipeline", async () => {
    const ctx = createCtx({ data: "tr:srclang:es:42" });
    await handleSrcLangOverrideCallback(ctx);

    expect(resolveDirectionFromSource).toHaveBeenCalledWith(
      expect.objectContaining({ sourceLang: "es", nativeLang: "ru" }),
    );
    expect(ctx.session.pendingWord).toBe("pero");
    expect(ctx.session.pendingContextHint).toBe("sport");
    expect(ctx.session.pendingDirection).toEqual({ sourceLang: "es", targetLangs: ["ru"] });
    expect(handleMistypeConfirmCallback).toHaveBeenCalledWith(ctx);
    expect(vi.mocked(ctx.services.languageDetectionRepository.record)).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "override_used" }),
    );
  });

  it("answers a stale-session alert and does not retranslate when the card entry is gone", async () => {
    const ctx = createCtx({ entryOriginal: null });
    await handleSrcLangOverrideCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.objectContaining({ show_alert: true }));
    expect(handleMistypeConfirmCallback).not.toHaveBeenCalled();
    expect(ctx.session.pendingDirection).toBeUndefined();
  });

  it("does not crash or retranslate when the forced source cannot resolve a direction", async () => {
    vi.mocked(resolveDirectionFromSource).mockReturnValue(null);
    const ctx = createCtx({ data: "tr:srclang:zz:42" });
    await handleSrcLangOverrideCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.objectContaining({ show_alert: true }));
    expect(handleMistypeConfirmCallback).not.toHaveBeenCalled();
  });
});
