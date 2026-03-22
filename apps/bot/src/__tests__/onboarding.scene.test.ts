import { describe, it, expect, vi, beforeEach } from "vitest";
import { onboarding } from "../scenes/onboarding.scene.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@polyglot/adapter-db", () => ({
  userRepository: {
    findByTelegramId: vi.fn(),
    updateOnboardingStep: vi.fn(),
    updateSettings: vi.fn(),
    markOnboarded: vi.fn(),
    updateActiveMode: vi.fn().mockResolvedValue({}),
  },
  getSupportedLangs: () => [
    { code: "ru", name: "Russian", nativeName: "Русский", flag: "🇷🇺", iso3Code: "rus", isSupported: true },
    { code: "en", name: "English", nativeName: "English", flag: "🇬🇧", iso3Code: "eng", isSupported: true },
    { code: "cs", name: "Czech", nativeName: "Čeština", flag: "🇨🇿", iso3Code: "ces", isSupported: true },
    { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪", iso3Code: "deu", isSupported: true },
    { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷", iso3Code: "fra", isSupported: true },
    { code: "es", name: "Spanish", nativeName: "Español", flag: "🇪🇸", iso3Code: "spa", isSupported: true },
    { code: "it", name: "Italian", nativeName: "Italiano", flag: "🇮🇹", iso3Code: "ita", isSupported: true },
    { code: "pt", name: "Portuguese", nativeName: "Português", flag: "🇵🇹", iso3Code: "por", isSupported: true },
    { code: "uk", name: "Ukrainian", nativeName: "Українська", flag: "🇺🇦", iso3Code: "ukr", isSupported: true },
    { code: "pl", name: "Polish", nativeName: "Polski", flag: "🇵🇱", iso3Code: "pol", isSupported: true },
  ],
  getLangDisplay: (code: string) => {
    const map: Record<string, string> = {
      ru: "🇷🇺 Русский", en: "🇬🇧 English", cs: "🇨🇿 Čeština",
      de: "🇩🇪 Deutsch", fr: "🇫🇷 Français", es: "🇪🇸 Español",
      it: "🇮🇹 Italiano", pt: "🇵🇹 Português", uk: "🇺🇦 Українська",
      pl: "🇵🇱 Polski",
    };
    return map[code] ?? code;
  },
}));

vi.mock("@polyglot/infra", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// Import after mock so we get the mocked version
import { userRepository } from "@polyglot/adapter-db";

const repo = vi.mocked(userRepository);

// ── Test helpers ─────────────────────────────────────────────────────────────

type UserAction =
  | { type: "callback"; data: string }
  | { type: "text"; text: string };

/** Shorthand: callback query action */
const cb = (data: string): UserAction => ({ type: "callback", data });

/** Shorthand: text message action */
const txt = (text: string): UserAction => ({ type: "text", text });

const FAKE_USER = {
  id: 1,
  telegramId: 123456,
  username: null,
  onboardingStep: 0,
  onboarded: false,
  isActive: true,
  createdAt: new Date(),
} as const;

/**
 * Build mock conversation + context that replays a scripted sequence.
 * Both waitForCallbackQuery and waitUntil pull from the same ordered queue.
 */
function setup(
  actions: UserAction[],
  user: typeof FAKE_USER | null = FAKE_USER,
) {
  let idx = 0;

  repo.findByTelegramId.mockResolvedValue(user);
  repo.updateOnboardingStep.mockResolvedValue(FAKE_USER as any);
  repo.updateSettings.mockResolvedValue({} as any);
  repo.markOnboarded.mockResolvedValue(FAKE_USER as any);

  function nextResponseCtx() {
    if (idx >= actions.length) {
      throw new Error(`No more scripted actions at index ${idx}`);
    }
    const action = actions[idx++];
    return {
      callbackQuery:
        action.type === "callback" ? { data: action.data } : undefined,
      message: action.type === "text" ? { text: action.text } : undefined,
      answerCallbackQuery: vi.fn(),
      editMessageText: vi.fn(),
      editMessageReplyMarkup: vi.fn(),
      reply: vi.fn(),
    };
  }

  const conversation = {
    external: vi.fn(async (fn: () => unknown) => fn()),
    waitForCallbackQuery: vi.fn(async () => nextResponseCtx()),
    waitUntil: vi.fn(async () => nextResponseCtx()),
  } as any;

  const ctx = {
    from: { id: 123456 },
    reply: vi.fn(async () => ({ message_id: 1 })),
    session: {
      activeMode: "idle",
      pendingTranslation: undefined,
      pendingCardMsgId: undefined,
      nextSourceLang: null,
    },
  } as any;

  return { conversation, ctx };
}

/** Get inline_keyboard rows from the Nth ctx.reply call (0-based). */
function getKeyboard(ctx: any, callIndex: number): any[][] {
  const args = ctx.reply.mock.calls[callIndex];
  return args?.[1]?.reply_markup?.inline_keyboard ?? [];
}

/** True if any button in the keyboard has the given callback_data. */
function hasButton(keyboard: any[][], callbackData: string): boolean {
  return keyboard.some((row: any[]) =>
    row.some((btn: any) => btn.callback_data === callbackData),
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Forward-only flow ────────────────────────────────────────────────────

  describe("forward-only flow", () => {
    it("completes all 4 steps and marks user as onboarded", async () => {
      const { conversation, ctx } = setup([
        cb("lang:en"), // Step 1: interface language
        cb("lang:ru"), // Step 2: native language
        cb("learn:cs"), // Step 3: select Czech
        cb("learn:done"), // Step 3: confirm
        txt("hello"), // Step 4: enter word
        cb("demo:save"), // Step 4: save
      ]);

      await onboarding(conversation, ctx);

      expect(repo.updateOnboardingStep).toHaveBeenCalledWith(1, 1);
      expect(repo.updateOnboardingStep).toHaveBeenCalledWith(1, 2);
      expect(repo.updateOnboardingStep).toHaveBeenCalledWith(1, 3);
      expect(repo.updateSettings).toHaveBeenCalledWith(1, {
        interfaceLang: "en",
        nativeLang: "ru",
        learningLangs: ["cs"],
      });
      expect(repo.markOnboarded).toHaveBeenCalledWith(1);
    });

    it("sets activeMode to 'translate' after completion", async () => {
      const { conversation, ctx } = setup([
        cb("lang:en"),
        cb("lang:ru"),
        cb("learn:cs"),
        cb("learn:done"),
        txt("hello"),
        cb("demo:save"),
      ]);

      expect(ctx.session.activeMode).toBe("idle"); // before
      await onboarding(conversation, ctx);
      expect(ctx.session.activeMode).toBe("translate"); // after
    });

    it("persists activeMode to DB after completion", async () => {
      const { conversation, ctx } = setup([
        cb("lang:en"),
        cb("lang:ru"),
        cb("learn:cs"),
        cb("learn:done"),
        txt("hello"),
        cb("demo:save"),
      ]);

      await onboarding(conversation, ctx);

      expect(repo.updateActiveMode).toHaveBeenCalledWith(1, "translate");
    });

    it("handles demo skip (no save) and still completes", async () => {
      const { conversation, ctx } = setup([
        cb("lang:en"),
        cb("lang:ru"),
        cb("learn:cs"),
        cb("learn:done"),
        txt("hello"),
        cb("demo:skip"), // skip saving
      ]);

      await onboarding(conversation, ctx);

      expect(repo.markOnboarded).toHaveBeenCalledWith(1);
    });
  });

  // ── User not found ───────────────────────────────────────────────────────

  describe("user not found", () => {
    it("replies with error and does not proceed", async () => {
      const { conversation, ctx } = setup([], null);

      await onboarding(conversation, ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        "Something went wrong. Please try /start again.",
      );
      expect(repo.markOnboarded).not.toHaveBeenCalled();
      expect(repo.updateOnboardingStep).not.toHaveBeenCalled();
    });
  });

  // ── Back navigation ──────────────────────────────────────────────────────

  describe("back navigation", () => {
    it("back from step 2 returns to step 1 and completes with new choice", async () => {
      const { conversation, ctx } = setup([
        cb("lang:en"), // Step 1: pick English
        cb("onb:back"), // Step 2: back
        cb("lang:ru"), // Step 1 (again): pick Russian
        cb("lang:en"), // Step 2 (again): pick English as native
        cb("learn:cs"), // Step 3
        cb("learn:done"),
        txt("hello"), // Step 4
        cb("demo:save"),
      ]);

      await onboarding(conversation, ctx);

      expect(repo.markOnboarded).toHaveBeenCalled();
      expect(repo.updateSettings).toHaveBeenCalledWith(1, {
        interfaceLang: "ru", // changed on second pass
        nativeLang: "en",
        learningLangs: ["cs"],
      });
    });

    it("back from step 3 returns to step 2 and completes with new choice", async () => {
      const { conversation, ctx } = setup([
        cb("lang:en"), // Step 1
        cb("lang:ru"), // Step 2: pick Russian
        cb("learn:back"), // Step 3: back
        cb("lang:en"), // Step 2 (again): change to English
        cb("learn:cs"), // Step 3 (again)
        cb("learn:done"),
        txt("hello"),
        cb("demo:save"),
      ]);

      await onboarding(conversation, ctx);

      expect(repo.markOnboarded).toHaveBeenCalled();
      expect(repo.updateSettings).toHaveBeenCalledWith(1, {
        interfaceLang: "en",
        nativeLang: "en", // changed on second pass
        learningLangs: ["cs"],
      });
    });

    it("back from step 4 returns to step 3 and completes with new choice", async () => {
      const { conversation, ctx } = setup([
        cb("lang:en"), // Step 1
        cb("lang:ru"), // Step 2
        cb("learn:cs"), // Step 3: select Czech
        cb("learn:done"),
        cb("onb:back"), // Step 4: back
        cb("learn:de"), // Step 3 (again): select German
        cb("learn:done"),
        txt("hello"), // Step 4 (again)
        cb("demo:save"),
      ]);

      await onboarding(conversation, ctx);

      expect(repo.markOnboarded).toHaveBeenCalled();
      // Last updateSettings call should have the new languages
      expect(repo.updateSettings).toHaveBeenLastCalledWith(1, {
        interfaceLang: "en",
        nativeLang: "ru",
        learningLangs: ["de"], // changed on second pass
      });
    });

    it("supports multiple consecutive backs (4 → 3 → 2 → 1) and completes", async () => {
      const { conversation, ctx } = setup([
        cb("lang:en"), // Step 1
        cb("lang:ru"), // Step 2
        cb("learn:cs"), // Step 3
        cb("learn:done"),
        cb("onb:back"), // Step 4: back → 3
        cb("learn:back"), // Step 3: back → 2
        cb("onb:back"), // Step 2: back → 1
        cb("lang:cs"), // Step 1 (again): pick Czech
        cb("lang:ru"), // Step 2 (again)
        cb("learn:en"), // Step 3 (again): select English
        cb("learn:done"),
        txt("world"), // Step 4 (again)
        cb("demo:skip"),
      ]);

      await onboarding(conversation, ctx);

      expect(repo.markOnboarded).toHaveBeenCalled();
      expect(repo.updateSettings).toHaveBeenLastCalledWith(1, {
        interfaceLang: "cs",
        nativeLang: "ru",
        learningLangs: ["en"],
      });
    });

    it("back from step 3 resets learning language selection", async () => {
      const { conversation, ctx } = setup([
        cb("lang:en"), // Step 1
        cb("lang:ru"), // Step 2
        cb("learn:cs"), // Step 3: select Czech
        cb("learn:de"), // Step 3: select German
        cb("learn:back"), // Step 3: back (selection discarded)
        cb("lang:ru"), // Step 2 (again)
        cb("learn:fr"), // Step 3 (again): only French this time
        cb("learn:done"),
        txt("hello"),
        cb("demo:save"),
      ]);

      await onboarding(conversation, ctx);

      expect(repo.updateSettings).toHaveBeenLastCalledWith(1, {
        interfaceLang: "en",
        nativeLang: "ru",
        learningLangs: ["fr"], // previous cs+de selection was discarded
      });
    });
  });

  // ── DB call ordering during back navigation ──────────────────────────────

  describe("DB calls during back navigation", () => {
    it("does not call updateOnboardingStep when going back", async () => {
      const { conversation, ctx } = setup([
        cb("lang:en"), // Step 1: forward
        cb("onb:back"), // Step 2: back (no step-2 DB call)
        cb("lang:en"), // Step 1: forward (again)
        cb("lang:ru"), // Step 2: forward
        cb("learn:cs"),
        cb("learn:done"),
        txt("hello"),
        cb("demo:save"),
      ]);

      await onboarding(conversation, ctx);

      // Step 1 completed twice, step 2 once, step 3 once
      expect(repo.updateOnboardingStep.mock.calls).toEqual([
        [1, 1],
        [1, 1],
        [1, 2],
        [1, 3],
      ]);
    });

    it("calls updateSettings again after back from step 4 and re-completing step 3", async () => {
      const { conversation, ctx } = setup([
        cb("lang:en"),
        cb("lang:ru"),
        cb("learn:cs"),
        cb("learn:done"), // first step 3 completion → updateSettings #1
        cb("onb:back"), // Step 4: back → 3
        cb("learn:de"),
        cb("learn:done"), // second step 3 completion → updateSettings #2
        txt("hello"),
        cb("demo:save"),
      ]);

      await onboarding(conversation, ctx);

      expect(repo.updateSettings).toHaveBeenCalledTimes(2);
      expect(repo.updateSettings).toHaveBeenNthCalledWith(1, 1, {
        interfaceLang: "en",
        nativeLang: "ru",
        learningLangs: ["cs"],
      });
      expect(repo.updateSettings).toHaveBeenNthCalledWith(2, 1, {
        interfaceLang: "en",
        nativeLang: "ru",
        learningLangs: ["de"],
      });
    });

    it("calls markOnboarded exactly once at the end", async () => {
      const { conversation, ctx } = setup([
        cb("lang:en"),
        cb("onb:back"), // back from step 2
        cb("lang:en"),
        cb("lang:ru"),
        cb("learn:back"), // back from step 3
        cb("lang:ru"),
        cb("learn:cs"),
        cb("learn:done"),
        cb("onb:back"), // back from step 4
        cb("learn:cs"),
        cb("learn:done"),
        txt("hello"),
        cb("demo:save"),
      ]);

      await onboarding(conversation, ctx);

      expect(repo.markOnboarded).toHaveBeenCalledTimes(1);
      expect(repo.markOnboarded).toHaveBeenCalledWith(1);
    });
  });

  // ── Back button presence in keyboards ────────────────────────────────────

  describe("back button presence in keyboards", () => {
    async function runFullFlow() {
      const harness = setup([
        cb("lang:en"),
        cb("lang:ru"),
        cb("learn:cs"),
        cb("learn:done"),
        txt("hello"),
        cb("demo:save"),
      ]);
      await onboarding(harness.conversation, harness.ctx);
      return harness.ctx;
    }

    it("step 1 keyboard does NOT have a back button", async () => {
      const ctx = await runFullFlow();
      // ctx.reply call [0] = step 1 prompt
      const kb = getKeyboard(ctx, 0);
      expect(hasButton(kb, "onb:back")).toBe(false);
    });

    it("step 2 keyboard HAS a back button", async () => {
      const ctx = await runFullFlow();
      // ctx.reply call [1] = step 2 prompt
      const kb = getKeyboard(ctx, 1);
      expect(hasButton(kb, "onb:back")).toBe(true);
    });

    it("step 3 keyboard HAS a back button", async () => {
      const ctx = await runFullFlow();
      // ctx.reply call [2] = step 3 prompt
      const kb = getKeyboard(ctx, 2);
      expect(hasButton(kb, "learn:back")).toBe(true);
    });

    it("step 4 (enter word) prompt HAS a back button", async () => {
      const ctx = await runFullFlow();
      // ctx.reply call [3] = step 4 "enter word" prompt
      const kb = getKeyboard(ctx, 3);
      expect(hasButton(kb, "onb:back")).toBe(true);
    });

    it("step 4 (save/skip) prompt does NOT have a back button", async () => {
      const ctx = await runFullFlow();
      // ctx.reply call [4] = step 4 translation result prompt
      const kb = getKeyboard(ctx, 4);
      expect(hasButton(kb, "onb:back")).toBe(false);
      expect(hasButton(kb, "learn:back")).toBe(false);
    });
  });
});
