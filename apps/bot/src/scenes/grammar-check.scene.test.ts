import { t } from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PLAN_LIMIT } from "../test-helpers/services-stub.js";
import type { BotContext, SessionData } from "../types.js";
import { handleGrammarCheckCommand } from "./grammar-check.scene.js";

function createMockCtx(): BotContext {
  return {
    chat: { id: 42 },
    session: {
      activeMode: "translate",
      awaitingNotifContext: true,
      dictionaryWizard: { kind: "search" },
      awaitingTranslationClarificationContext: true,
      pendingCardMentorAsk: { messageId: 9 },
    } as unknown as SessionData,
    reply: vi.fn().mockResolvedValue({ message_id: 100 }),
    user: { id: 1, telegramId: 42, onboarded: true, audienceGroup: "product", subscriptionPlan: "free" },
    services: {
      productEventRepository: { record: vi.fn().mockResolvedValue(undefined) },
      userRepository: {
        getSettings: vi.fn().mockResolvedValue({ interfaceLang: "en", nativeLang: "en", learningLangs: ["cs"] }),
        updateActiveMode: vi.fn().mockResolvedValue(undefined),
      },
      settings: { getPlanLimit: vi.fn().mockResolvedValue(DEFAULT_PLAN_LIMIT) },
      translationRequestRepository: { countRequestsInWindow: vi.fn().mockResolvedValue(0) },
    },
  } as unknown as BotContext;
}

describe("handleGrammarCheckCommand", () => {
  it("disarms every waiting prompt, so the first sentence is checked instead of swallowed by an abandoned flow", async () => {
    const ctx = createMockCtx();

    await handleGrammarCheckCommand(ctx);

    expect(ctx.session.activeMode).toBe("grammar");
    expect(ctx.session.awaitingNotifContext).toBe(false);
    expect(ctx.session.dictionaryWizard).toBeUndefined();
    expect(ctx.session.awaitingTranslationClarificationContext).toBeUndefined();
    expect(ctx.session.pendingCardMentorAsk).toBeUndefined();
    expect(vi.mocked(ctx.reply).mock.calls[0]?.[0]).toBe(t("grammarCheckModeOn", "en"));
  });
});
