/**
 * The one free onboarding video (Task 72).
 *
 * The free plan allows **3 videos lifetime**, not per month. A starter video
 * offered on the onboarding empty state would therefore cost a third of
 * everything a new user ever gets, spent before they have seen what the feature
 * does. A run started from those suggestions bypasses the allowance and is
 * recorded as a trial; trial rows are excluded from both usage counts, and each
 * user gets exactly one.
 */
import type { ServiceContainer } from "@polyglot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServicesStub } from "../../../test-helpers/services-stub.js";
import type { BotContext } from "../../../types.js";

const { fetchMetadata } = vi.hoisted(() => ({ fetchMetadata: vi.fn() }));
vi.mock("@polyglot/adapter-youtube", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@polyglot/adapter-youtube")>()),
  fetchMetadata,
}));

const { handleVideoVocabularyUrl } = await import("../video-vocabulary.helper.js");

const URL = "https://youtu.be/aaaaaaaaaaa";

function createCtx(opts: { plan?: string; lifetimeUsed?: number; trialUsed?: boolean } = {}) {
  const videoVocabularyRepository = {
    expireStaleProcesses: vi.fn().mockResolvedValue(0),
    findProcessByUserAndVideo: vi.fn().mockResolvedValue(null),
    getLifetimeUsageCount: vi.fn().mockResolvedValue(opts.lifetimeUsed ?? 0),
    getMonthlyUsageCount: vi.fn().mockResolvedValue(0),
    hasCompletedTrial: vi.fn().mockResolvedValue(opts.trialUsed ?? false),
    createProcess: vi.fn().mockResolvedValue({ id: 99 }),
    updateProcessStatus: vi.fn().mockResolvedValue(undefined),
    findCachedTranscript: vi.fn().mockResolvedValue(null),
  };

  const ctx = {
    user: { id: 1, audienceGroup: "product", subscriptionPlan: opts.plan ?? "free" },
    chat: { id: 1 },
    session: {},
    api: { editMessageText: vi.fn().mockResolvedValue(true) },
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
    services: createServicesStub({
      userRepository: {
        getSettings: vi.fn().mockResolvedValue({ interfaceLang: "en", nativeLang: "en", learningLangs: ["de"] }),
      } as unknown as ServiceContainer["userRepository"],
      videoVocabularyRepository: videoVocabularyRepository as unknown as ServiceContainer["videoVocabularyRepository"],
    }),
  } as unknown as BotContext;

  return { ctx, videoVocabularyRepository };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMetadata.mockResolvedValue({ title: "Straßeninterview", durationSeconds: 600 });
});

describe("onboarding starter video — allowance exemption", () => {
  it("records a suggestion-started run as a trial and never reads the allowance", async () => {
    const { ctx, videoVocabularyRepository } = createCtx();

    await handleVideoVocabularyUrl(ctx, URL, { fromOnboarding: true });

    expect(videoVocabularyRepository.createProcess).toHaveBeenCalledWith(expect.objectContaining({ isTrial: true }));
    expect(videoVocabularyRepository.getLifetimeUsageCount).not.toHaveBeenCalled();
  });

  it("runs the starter video even when the lifetime allowance is already exhausted", async () => {
    // The whole point: a brand-new user must be able to try it, and an exhausted
    // allowance must not be what greets them on the onboarding screen.
    const { ctx, videoVocabularyRepository } = createCtx({ lifetimeUsed: 3 });

    await handleVideoVocabularyUrl(ctx, URL, { fromOnboarding: true });

    expect(videoVocabularyRepository.createProcess).toHaveBeenCalledWith(expect.objectContaining({ isTrial: true }));
  });

  it("gives the giveaway only once — a second suggestion falls back to the allowance", async () => {
    const { ctx, videoVocabularyRepository } = createCtx({ trialUsed: true });

    await handleVideoVocabularyUrl(ctx, URL, { fromOnboarding: true });

    expect(videoVocabularyRepository.getLifetimeUsageCount).toHaveBeenCalled();
    expect(videoVocabularyRepository.createProcess).toHaveBeenCalledWith(expect.objectContaining({ isTrial: false }));
  });

  it("blocks a second suggestion once the allowance is also gone", async () => {
    const { ctx, videoVocabularyRepository } = createCtx({ trialUsed: true, lifetimeUsed: 3 });

    await handleVideoVocabularyUrl(ctx, URL, { fromOnboarding: true });

    expect(videoVocabularyRepository.createProcess).not.toHaveBeenCalled();
  });

  it("leaves a pasted link on the normal allowance path", async () => {
    const { ctx, videoVocabularyRepository } = createCtx();

    await handleVideoVocabularyUrl(ctx, URL);

    expect(videoVocabularyRepository.hasCompletedTrial).not.toHaveBeenCalled();
    expect(videoVocabularyRepository.getLifetimeUsageCount).toHaveBeenCalled();
    expect(videoVocabularyRepository.createProcess).toHaveBeenCalledWith(expect.objectContaining({ isTrial: false }));
  });
});
