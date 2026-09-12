/**
 * Voice message → the active mode (Task 80).
 *
 * The refusals are the interesting part, and their ORDER is what these pin: the
 * feature switch, the plan, and the duration cap each have to bite before any
 * money is spent, so a refused voice message must reach neither Telegram's file
 * API nor the transcription model. The success path proves the transcript
 * re-enters the ordinary text pipeline — whichever mode owns it.
 */
import { FEATURE_KEYS, type PlanLimitConfig, type ServiceContainer, type SttConfig } from "@polyglot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServicesStub, createSettingsStub } from "../../../test-helpers/services-stub.js";
import type { BotContext, UserMode } from "../../../types.js";

const { handleTranslateText, handleMentorText } = vi.hoisted(() => ({
  handleTranslateText: vi.fn().mockResolvedValue(undefined),
  handleMentorText: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../translate-flow.js", () => ({ handleTranslateText }));
vi.mock("../mentor-mode.helper.js", () => ({ handleMentorText }));

const { handleVoiceMessage } = await import("../voice-input.js");

const STT: SttConfig = { enabled: true, modelId: "openai/whisper-large-v3-turbo", maxDurationSec: 60 };

const PRO_PLAN: PlanLimitConfig = {
  name: "pro",
  label: "Pro",
  translationLimit: null,
  creditCost: 1,
  videoLimit: null,
  videoWindow: "monthly",
  mentorDailyLimit: null,
  priceUsdCents: 1000,
  isActive: true,
  isDefault: false,
};

interface CtxOptions {
  stt?: Partial<SttConfig>;
  duration?: number;
  hasAccess?: boolean;
  transcribe?: ReturnType<typeof vi.fn>;
  activeMode?: UserMode;
  /** Makes the voice message a reply to the bot message with this id. */
  replyToMessageId?: number;
  /** Thread the replied-to message belongs to, as `mentor_messages` would answer. */
  replyThreadId?: string | null;
}

function createCtx(opts: CtxOptions = {}) {
  const transcribe =
    opts.transcribe ??
    vi.fn().mockResolvedValue({ text: "  Hallo  ", seconds: 2, costUsd: 0.1, generationId: "gen-1" });
  const download = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
  const getFile = vi.fn().mockResolvedValue({ file_id: "v1", file_unique_id: "u1", file_path: "voice/file_1.oga" });
  const reply = vi.fn().mockResolvedValue({ message_id: 1 });
  const answerCallbackQuery = vi.fn().mockResolvedValue(true);

  const findThreadByMessage = vi.fn().mockResolvedValue(opts.replyThreadId ?? null);

  const ctx = {
    user: { id: 1, audienceGroup: "product", subscriptionPlan: opts.hasAccess === false ? "free" : "pro" },
    chat: { id: 1 },
    me: { id: 42 },
    session: { activeMode: opts.activeMode ?? "translate" },
    message: {
      message_id: 7,
      voice: { file_id: "v1", file_unique_id: "u1", duration: opts.duration ?? 5 },
      ...(opts.replyToMessageId !== undefined
        ? { reply_to_message: { message_id: opts.replyToMessageId, from: { id: 42, is_bot: true } } }
        : {}),
    },
    api: { getFile, token: "TEST:TOKEN", options: { fetch: download } },
    reply,
    answerCallbackQuery,
    replyWithChatAction: vi.fn().mockResolvedValue(true),
    services: createServicesStub({
      userRepository: {
        getSettings: vi.fn().mockResolvedValue({ interfaceLang: "en", nativeLang: "en", learningLangs: ["de"] }),
      } as unknown as ServiceContainer["userRepository"],
      settings: {
        ...createSettingsStub(),
        getSttConfig: vi.fn().mockResolvedValue({ ...STT, ...opts.stt }),
        getPlanLimits: vi.fn().mockResolvedValue([PRO_PLAN]),
      },
      featureAccess: {
        listFeatures: vi.fn().mockResolvedValue(new Set()),
        listPlanFeatures: vi.fn().mockResolvedValue(new Set([FEATURE_KEYS.voiceInput])),
        checkFeatureAccess: vi.fn().mockResolvedValue({ hasAccess: opts.hasAccess ?? true }),
      } as unknown as ServiceContainer["featureAccess"],
      ai: { transcribe } as unknown as ServiceContainer["ai"],
      mentorMessageRepository: {
        findThreadByMessage,
      } as unknown as ServiceContainer["mentorMessageRepository"],
    }),
  } as unknown as BotContext;

  return { ctx, transcribe, getFile, reply, answerCallbackQuery, findThreadByMessage };
}

const lastReply = (reply: ReturnType<typeof vi.fn>): string => String(reply.mock.calls.at(-1)?.[0] ?? "");

describe("voice message handling", () => {
  beforeEach(() => {
    handleTranslateText.mockClear();
    handleMentorText.mockClear();
  });

  it("declines the update when speech-to-text is switched off, leaving the old non-text rejection to the caller", async () => {
    const { ctx, getFile, transcribe, reply } = createCtx({ stt: { enabled: false } });

    await expect(handleVoiceMessage(ctx)).resolves.toBe(false);

    expect(getFile).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
  });

  it("treats a blank model id as switched off — there is nothing to call", async () => {
    const { ctx, transcribe } = createCtx({ stt: { modelId: "   " } });

    await expect(handleVoiceMessage(ctx)).resolves.toBe(false);

    expect(transcribe).not.toHaveBeenCalled();
  });

  it("offers the upgrade screen to a plan without the feature, without touching Telegram or the model", async () => {
    const { ctx, getFile, transcribe, reply, answerCallbackQuery } = createCtx({ hasAccess: false });

    await expect(handleVoiceMessage(ctx)).resolves.toBe(true);

    // A message has no callback query to answer — answering one would throw.
    expect(answerCallbackQuery).not.toHaveBeenCalled();
    expect(lastReply(reply)).toContain("Voice input");
    expect(getFile).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("refuses a recording longer than the cap before downloading a byte", async () => {
    const { ctx, getFile, transcribe, reply } = createCtx({ duration: 61, stt: { maxDurationSec: 60 } });

    await expect(handleVoiceMessage(ctx)).resolves.toBe(true);

    expect(lastReply(reply)).toContain("60");
    expect(getFile).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("reports a failed transcription instead of translating nothing", async () => {
    const { ctx, reply } = createCtx({ transcribe: vi.fn().mockRejectedValue(new Error("provider down")) });

    await expect(handleVoiceMessage(ctx)).resolves.toBe(true);

    expect(lastReply(reply)).toContain("Couldn't recognize");
    expect(handleTranslateText).not.toHaveBeenCalled();
  });

  it("reports silence the same way — an empty transcript is nothing to translate", async () => {
    const { ctx, reply } = createCtx({
      transcribe: vi.fn().mockResolvedValue({ text: "   ", seconds: 1, costUsd: 0, generationId: null }),
    });

    await expect(handleVoiceMessage(ctx)).resolves.toBe(true);

    expect(lastReply(reply)).toContain("Couldn't recognize");
    expect(handleTranslateText).not.toHaveBeenCalled();
  });

  it("feeds the transcript into the ordinary text translation flow", async () => {
    const { ctx, transcribe, getFile } = createCtx();

    await expect(handleVoiceMessage(ctx)).resolves.toBe(true);

    expect(getFile).toHaveBeenCalledWith("v1");
    expect(transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ format: "ogg", modelId: STT.modelId, userId: 1 }),
    );
    expect(handleTranslateText).toHaveBeenCalledWith(ctx, "Hallo");
  });

  it("sends the transcript to the mentor while mentor mode is active, not to translation", async () => {
    const { ctx } = createCtx({ activeMode: "mentor" });

    await expect(handleVoiceMessage(ctx)).resolves.toBe(true);

    expect(handleMentorText).toHaveBeenCalledWith(ctx, "Hallo");
    expect(handleTranslateText).not.toHaveBeenCalled();
  });

  it("continues a mentor thread when the voice message replies to a mentor answer, whatever the mode", async () => {
    const { ctx, findThreadByMessage } = createCtx({
      activeMode: "translate",
      replyToMessageId: 99,
      replyThreadId: "thread-1",
    });

    await expect(handleVoiceMessage(ctx)).resolves.toBe(true);

    expect(findThreadByMessage).toHaveBeenCalledWith(1, 99);
    expect(handleMentorText).toHaveBeenCalledWith(ctx, "Hallo", { threadId: "thread-1" });
    expect(handleTranslateText).not.toHaveBeenCalled();
  });

  it("translates a voice reply that anchors to no mentor thread", async () => {
    const { ctx } = createCtx({ activeMode: "translate", replyToMessageId: 99, replyThreadId: null });

    await expect(handleVoiceMessage(ctx)).resolves.toBe(true);

    expect(handleMentorText).not.toHaveBeenCalled();
    expect(handleTranslateText).toHaveBeenCalledWith(ctx, "Hallo");
  });

  it("downloads the audio through the bot's own fetch, so the transport stays injectable", async () => {
    const { ctx } = createCtx();
    const download = (ctx.api as unknown as { options: { fetch: ReturnType<typeof vi.fn> } }).options.fetch;

    await handleVoiceMessage(ctx);

    expect(download).toHaveBeenCalledWith("https://api.telegram.org/file/botTEST:TOKEN/voice/file_1.oga");
  });
});
