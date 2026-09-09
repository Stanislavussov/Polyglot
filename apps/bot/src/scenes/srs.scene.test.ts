/**
 * `/review` empty states.
 *
 * "Nothing due right now" and "you have not saved anything yet" are different
 * situations that shared one ✅-prefixed message. Onboarding turned the second
 * one into the common case — its final screen offers a 🎯 Practice button to a
 * user whose dictionary is necessarily still empty — and telling that user they
 * are all caught up is telling them they finished something they never started.
 */
import type { ServiceContainer } from "@polyglot/core";
import { t } from "@polyglot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServicesStub } from "../test-helpers/services-stub.js";
import type { BotContext } from "../types.js";
import { handleReviewCommand } from "./srs.scene.js";

function createCtx(opts: { savedWords: number; dueWords?: number }) {
  const due = Array.from({ length: opts.dueWords ?? 0 }, (_, index) => ({
    id: index + 1,
    original: "Katze",
    emoji: "🐈",
    inputType: "word" as const,
    sourceLangId: 1,
    targetLangId: 2,
    translation: "кошка",
  }));

  const vocabularyRepository = {
    findDueForSrs: vi.fn().mockResolvedValue(due),
    countByUser: vi.fn().mockResolvedValue(opts.savedWords),
  };
  const userRepository = {
    getSettings: vi.fn().mockResolvedValue({ interfaceLang: "ru" }),
  };

  const ctx = {
    user: { id: 1 },
    session: {},
    reply: vi.fn().mockResolvedValue({ message_id: 10 }),
    services: createServicesStub({
      vocabularyRepository: vocabularyRepository as unknown as ServiceContainer["vocabularyRepository"],
      userRepository: userRepository as unknown as ServiceContainer["userRepository"],
      languageCache: {
        getAllLangs: () => [
          { id: 1, code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪", isSupported: true },
          { id: 2, code: "ru", name: "Russian", nativeName: "Русский", flag: "🇷🇺", isSupported: true },
        ],
      } as unknown as ServiceContainer["languageCache"],
    }),
  } as unknown as BotContext;

  return { ctx, vocabularyRepository };
}

describe("handleReviewCommand — empty deck", () => {
  beforeEach(() => vi.clearAllMocks());

  it("tells a user with nothing saved how to get a word into the deck", async () => {
    const { ctx } = createCtx({ savedWords: 0 });

    await handleReviewCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("srsNoSavedWords", "ru"));
    // The "all caught up" wording must not reach someone who never started.
    expect(ctx.reply).not.toHaveBeenCalledWith(t("srsEmpty", "ru"));
  });

  it("tells a user who has saved words but has none due that they are caught up", async () => {
    const { ctx } = createCtx({ savedWords: 12 });

    await handleReviewCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("srsEmpty", "ru"));
  });

  it("does not pay for the count query when there is a deck to review", async () => {
    const { ctx, vocabularyRepository } = createCtx({ savedWords: 12, dueWords: 3 });

    await handleReviewCommand(ctx);

    expect(vocabularyRepository.countByUser).not.toHaveBeenCalled();
    expect(ctx.session.srs?.deck).toHaveLength(3);
  });
});
