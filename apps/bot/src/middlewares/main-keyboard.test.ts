/**
 * Tests for the one-time delivery of the persistent main-menu keyboard.
 */
import type { ServiceContainer } from "@polyglot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServicesStub } from "../test-helpers/services-stub.js";
import type { BotContext, SessionData } from "../types.js";
import { MAIN_KEYBOARD_VERSION, mainKeyboardMiddleware } from "./main-keyboard.js";

const repo = {
  getSettings: vi.fn(),
};

interface MockCtxOptions {
  onboarded?: boolean;
  keyboardVersion?: number;
  message?: boolean;
}

function createMockCtx(options: MockCtxOptions = {}): BotContext {
  const session = {
    activeMode: "translate",
    mainKeyboardVersion: options.keyboardVersion,
  } as SessionData;

  return {
    message: options.message === false ? undefined : { text: "hello", message_id: 7 },
    session,
    user: { id: 1, onboarded: options.onboarded ?? true },
    reply: vi.fn().mockResolvedValue({ message_id: 42 }),
    services: createServicesStub({
      userRepository: repo as unknown as ServiceContainer["userRepository"],
    }),
  } as unknown as BotContext;
}

describe("mainKeyboardMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.getSettings.mockResolvedValue({ interfaceLang: "ru" });
  });

  it("sends the keyboard with a hint in the user's interface language on first contact", async () => {
    const ctx = createMockCtx();
    const next = vi.fn();

    await mainKeyboardMiddleware(ctx, next);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const [text, options] = vi.mocked(ctx.reply).mock.calls[0] ?? [];
    // Points at the icon rather than listing the modes — the keyboard below the
    // text already names them, and the hint that spelled them out read as a third
    // copy of the same menu.
    expect(text).toContain("⌨️");
    expect(options?.reply_markup).toMatchObject({ one_time_keyboard: true });
    expect(next).toHaveBeenCalled();
  });

  it("marks the chat so the hint is never repeated", async () => {
    const ctx = createMockCtx();

    await mainKeyboardMiddleware(ctx, vi.fn());

    expect(ctx.session.mainKeyboardVersion).toBe(MAIN_KEYBOARD_VERSION);
  });

  it("leaves the chat unmarked when the send fails, so the next message retries", async () => {
    const ctx = createMockCtx();
    vi.mocked(ctx.reply).mockRejectedValueOnce(new Error("Bad Request: chat not found"));

    await expect(mainKeyboardMiddleware(ctx, vi.fn())).rejects.toThrow();

    expect(ctx.session.mainKeyboardVersion).toBeUndefined();
  });

  it("stays silent for a chat that already has the current keyboard", async () => {
    const ctx = createMockCtx({ keyboardVersion: MAIN_KEYBOARD_VERSION });
    const next = vi.fn();

    await mainKeyboardMiddleware(ctx, next);

    expect(ctx.reply).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("re-sends when the stored version is older than the current layout", async () => {
    const ctx = createMockCtx({ keyboardVersion: MAIN_KEYBOARD_VERSION - 1 });

    await mainKeyboardMiddleware(ctx, vi.fn());

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    expect(ctx.session.mainKeyboardVersion).toBe(MAIN_KEYBOARD_VERSION);
  });

  it("leaves users mid-onboarding alone — they get the keyboard once onboarding marks them done", async () => {
    const ctx = createMockCtx({ onboarded: false });
    const next = vi.fn();

    await mainKeyboardMiddleware(ctx, next);

    expect(ctx.reply).not.toHaveBeenCalled();
    expect(ctx.session.mainKeyboardVersion).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("ignores non-message updates, which cannot carry a reply keyboard", async () => {
    const ctx = createMockCtx({ message: false });
    const next = vi.fn();

    await mainKeyboardMiddleware(ctx, next);

    expect(ctx.reply).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
