import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockHandleTranslateCommand } = vi.hoisted(() => ({
  mockHandleTranslateCommand: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../translate.scene.js", () => ({
  handleTranslateCommand: mockHandleTranslateCommand,
}));

import type { ServiceContainer } from "@polyglot/core";
import { createServicesStub } from "../../test-helpers/services-stub.js";
import type { BotContext, SessionData } from "../../types.js";
import {
  handleMentorExitCallback,
  handleMentorNewTopicCallback,
  MENTOR_EXIT_CALLBACK,
  MENTOR_NEW_TOPIC_CALLBACK,
  mentorAnswerKeyboard,
  mentorExitKeyboard,
} from "./mentor-exit.helper.js";

const { mockUserRepository } = vi.hoisted(() => ({
  mockUserRepository: {
    updateActiveMode: vi.fn().mockResolvedValue({ activeMode: "mentor" }),
    getSettings: vi.fn().mockResolvedValue({ interfaceLang: "en", nativeLang: "en", learningLangs: ["cs"] }),
  },
}));

function createMockCtx(overrides?: Partial<SessionData>): BotContext {
  const session = {
    activeMode: "mentor",
    mentor: { threadId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    ...overrides,
  } as SessionData;
  return {
    chat: { id: 123456789 },
    session,
    user: { id: 1, telegramId: 123456789, onboarded: true, audienceGroup: "product", subscriptionPlan: "plus" },
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
    services: createServicesStub({
      userRepository: mockUserRepository as unknown as ServiceContainer["userRepository"],
    }),
  } as unknown as BotContext;
}

describe("mentorExitKeyboard", () => {
  it("carries a single button pointing at the exit callback", () => {
    const keyboard = mentorExitKeyboard("en");
    expect(keyboard.inline_keyboard).toHaveLength(1);
    const button = keyboard.inline_keyboard[0][0];
    expect("callback_data" in button ? button.callback_data : undefined).toBe(MENTOR_EXIT_CALLBACK);
    expect(button.text.length).toBeGreaterThan(0);
  });
});

describe("handleMentorExitCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears the mentor thread and delegates the mode switch to /translate", async () => {
    const ctx = createMockCtx();
    await handleMentorExitCallback(ctx);

    expect(ctx.session.mentor).toBeUndefined();
    // One mode-switch implementation, so the button and /translate cannot drift.
    expect(mockHandleTranslateCommand).toHaveBeenCalledWith(ctx);
    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalled();
  });

  it("still switches the mode when the tapped message is too old to edit (48h limit)", async () => {
    const ctx = createMockCtx();
    vi.mocked(ctx.editMessageReplyMarkup).mockRejectedValueOnce(new Error("message to edit not found"));

    await handleMentorExitCallback(ctx);

    expect(mockHandleTranslateCommand).toHaveBeenCalledWith(ctx);
  });
});

describe("mentorAnswerKeyboard", () => {
  it("offers new-topic and exit side by side", () => {
    const row = mentorAnswerKeyboard("en").inline_keyboard[0];
    expect(row.map((button) => ("callback_data" in button ? button.callback_data : undefined))).toEqual([
      MENTOR_NEW_TOPIC_CALLBACK,
      MENTOR_EXIT_CALLBACK,
    ]);
  });
});

describe("handleMentorNewTopicCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts a fresh thread in mentor mode and confirms", async () => {
    const ctx = createMockCtx();
    await handleMentorNewTopicCallback(ctx);

    // {} = "fresh, no recovery" — the next turn mints a new thread id.
    expect(ctx.session.mentor).toEqual({});
    expect(ctx.session.activeMode).toBe("mentor");
    expect(mockUserRepository.updateActiveMode).toHaveBeenCalledWith(1, "mentor");
    expect(ctx.reply).toHaveBeenCalled();
  });

  it("enters mentor mode when tapped from translate mode (button on an old answer)", async () => {
    const ctx = createMockCtx({ activeMode: "translate", mentor: undefined });
    await handleMentorNewTopicCallback(ctx);

    expect(ctx.session.activeMode).toBe("mentor");
    expect(ctx.session.mentor).toEqual({});
  });

  it("refuses a plan without the mentor feature before touching the mode", async () => {
    const denyAll = {
      listFeatures: vi.fn().mockResolvedValue(new Set()),
      listPlanFeatures: vi.fn().mockResolvedValue(new Set()),
      checkFeatureAccess: vi.fn().mockResolvedValue({ hasAccess: false, reason: "plan" }),
    } as unknown as ServiceContainer["featureAccess"];
    const ctx = createMockCtx({ activeMode: "translate", mentor: undefined });
    (ctx.services as { featureAccess: unknown }).featureAccess = denyAll;

    await handleMentorNewTopicCallback(ctx);

    expect(ctx.session.activeMode).toBe("translate");
    expect(mockUserRepository.updateActiveMode).not.toHaveBeenCalled();
    expect(ctx.session.mentor).toBeUndefined();
  });
});
