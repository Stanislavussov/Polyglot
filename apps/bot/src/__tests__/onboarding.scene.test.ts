import { beforeEach, describe, expect, it, vi } from "vitest";
import { onboarding } from "../scenes/onboarding.scene.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@polyglot/adapter-db", () => ({
  userRepository: {
    findByTelegramId: vi.fn(),
    updateOnboardingStep: vi.fn(),
    updateSettings: vi.fn(),
    markOnboarded: vi.fn(),
    updateActiveMode: vi.fn().mockResolvedValue({}),
    setLanguageLevel: vi.fn().mockResolvedValue(undefined),
  },
  getSupportedLangs: () => [
    { code: "ru", name: "Russian", nativeName: "Русский", flag: "🇷🇺", isSupported: true },
    { code: "en", name: "English", nativeName: "English", flag: "🇬🇧", isSupported: true },
    { code: "cs", name: "Czech", nativeName: "Čeština", flag: "🇨🇿", isSupported: true },
    { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪", isSupported: true },
    { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷", isSupported: true },
    { code: "es", name: "Spanish", nativeName: "Español", flag: "🇪🇸", isSupported: true },
    { code: "it", name: "Italian", nativeName: "Italiano", flag: "🇮🇹", isSupported: true },
    { code: "pt", name: "Portuguese", nativeName: "Português", flag: "🇵🇹", isSupported: true },
    { code: "uk", name: "Ukrainian", nativeName: "Українська", flag: "🇺🇦", isSupported: true },
    { code: "pl", name: "Polish", nativeName: "Polski", flag: "🇵🇱", isSupported: true },
  ],
  getLangDisplay: (code: string) => {
    const map: Record<string, string> = {
      ru: "🇷🇺 Русский",
      en: "🇬🇧 English",
      cs: "🇨🇿 Čeština",
      de: "🇩🇪 Deutsch",
      fr: "🇫🇷 Français",
      es: "🇪🇸 Español",
      it: "🇮🇹 Italiano",
      pt: "🇵🇹 Português",
      uk: "🇺🇦 Українська",
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

type UserAction = { type: "callback"; data: string } | { type: "text"; text: string };

/** Shorthand: callback query action */
const cb = (data: string): UserAction => ({ type: "callback", data });

/** Shorthand: text message action */
const txt = (text: string): UserAction => ({ type: "text", text });

const FAKE_USER = {
  id: 1,
  telegramId: 123456,
  username: null,
  audienceGroup: "product",
  subscriptionPlan: "free",
  onboardingStep: 0,
  onboarded: false,
  isActive: true,
  createdAt: new Date(),
} as const;

/**
 * Build mock conversation + context that replays a scripted sequence.
 * Both waitForCallbackQuery and waitUntil pull from the same ordered queue.
 */
function setup(actions: UserAction[], user: typeof FAKE_USER | null = FAKE_USER, telegramLocale?: string) {
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
      callbackQuery: action.type === "callback" ? { data: action.data } : undefined,
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
    from: { id: 123456, language_code: telegramLocale },
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
  return keyboard.some((row: any[]) => row.some((btn: any) => btn.callback_data === callbackData));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Forward-only flow (4 steps) ──────────────────────────────────────────

  describe("forward-only flow", () => {
    it("completes all 4 steps and marks user as onboarded", async () => {
      const { conversation, ctx } = setup([
        cb("lang:ru"), // Step 1: native language
        cb("learn:cs"), // Step 2: select Czech
        cb("learn:done"), // Step 2: confirm
        cb("level:cs:B2"), // Step 2.5: proficiency level
        txt("hello"), // Step 3: enter word (demo)
      ]);

      await onboarding(conversation, ctx);

      expect(repo.updateOnboardingStep).toHaveBeenCalledWith(1, 1);
      expect(repo.updateOnboardingStep).toHaveBeenCalledWith(1, 2);
      expect(repo.updateSettings).toHaveBeenCalledWith(1, {
        interfaceLang: "ru", // inferred from native language
        nativeLang: "ru",
        learningLangs: ["cs"],
        lastSourceLang: null,
      });
      expect(repo.markOnboarded).toHaveBeenCalledWith(1);
    });

    it("sets activeMode to 'translate' after completion", async () => {
      const { conversation, ctx } = setup([
        cb("lang:ru"),
        cb("learn:cs"),
        cb("learn:done"),
        cb("level:cs:B1"),
        txt("hello"),
      ]);

      expect(ctx.session.activeMode).toBe("idle"); // before
      await onboarding(conversation, ctx);
      expect(ctx.session.activeMode).toBe("translate"); // after
    });

    it("persists activeMode to DB after completion", async () => {
      const { conversation, ctx } = setup([
        cb("lang:ru"),
        cb("learn:cs"),
        cb("learn:done"),
        cb("level:cs:B1"),
        txt("hello"),
      ]);

      await onboarding(conversation, ctx);

      expect(repo.updateActiveMode).toHaveBeenCalledWith(1, "translate");
    });

    it("demo step shows result immediately without Save/Skip prompt", async () => {
      const { conversation, ctx } = setup([
        cb("lang:en"),
        cb("learn:cs"),
        cb("learn:done"),
        cb("level:cs:B1"),
        txt("hello"),
      ]);

      await onboarding(conversation, ctx);

      // After the word is entered, ctx.reply should be called with the
      // demo result (parse_mode: "Markdown") and then the completion message.
      // No Save/Skip keyboard should be shown.
      const replyCalls = ctx.reply.mock.calls;
      // Find the demo result call — it has parse_mode: "Markdown"
      const demoCall = replyCalls.find((call: any[]) => call[1]?.parse_mode === "Markdown");
      expect(demoCall).toBeDefined();
      // Should NOT have reply_markup (no Save/Skip buttons)
      expect(demoCall[1]?.reply_markup).toBeUndefined();

      expect(repo.markOnboarded).toHaveBeenCalledWith(1);
    });
  });

  // ── Interface language inference ─────────────────────────────────────────

  describe("interface language inference", () => {
    it("infers interface language from native language", async () => {
      const { conversation, ctx } = setup([
        cb("lang:ru"), // native = Russian
        cb("learn:en"),
        cb("learn:done"),
        cb("level:en:B2"), // proficiency
        txt("привет"),
      ]);

      await onboarding(conversation, ctx);

      expect(repo.updateSettings).toHaveBeenCalledWith(1, {
        interfaceLang: "ru", // inferred from native
        nativeLang: "ru",
        learningLangs: ["en"],
        lastSourceLang: null,
      });
    });

    it("uses native language over Telegram locale", async () => {
      const { conversation, ctx } = setup(
        [
          cb("lang:cs"), // native = Czech
          cb("learn:en"),
          cb("learn:done"),
          cb("level:en:A2"), // proficiency
          txt("ahoj"),
        ],
        FAKE_USER,
        "ru", // Telegram locale is Russian, but native is Czech
      );

      await onboarding(conversation, ctx);

      expect(repo.updateSettings).toHaveBeenCalledWith(1, {
        interfaceLang: "cs", // uses native, not Telegram locale
        nativeLang: "cs",
        learningLangs: ["en"],
        lastSourceLang: null,
      });
    });
  });

  // ── User not found ───────────────────────────────────────────────────────

  describe("user not found", () => {
    it("replies with error and does not proceed", async () => {
      const { conversation, ctx } = setup([], null);

      await onboarding(conversation, ctx);

      expect(ctx.reply).toHaveBeenCalledWith("Something went wrong. Please try /start again.");
      expect(repo.markOnboarded).not.toHaveBeenCalled();
      expect(repo.updateOnboardingStep).not.toHaveBeenCalled();
    });
  });

  // ── Back navigation ──────────────────────────────────────────────────────

  describe("back navigation", () => {
    it("back from step 2 returns to step 1 and completes with new choice", async () => {
      const { conversation, ctx } = setup([
        cb("lang:ru"), // Step 1: pick Russian
        cb("learn:back"), // Step 2: back
        cb("lang:en"), // Step 1 (again): pick English
        cb("learn:cs"), // Step 2 (again)
        cb("learn:done"),
        cb("level:cs:B1"), // Step 2.5: proficiency
        txt("hello"), // Step 4: demo
      ]);

      await onboarding(conversation, ctx);

      expect(repo.markOnboarded).toHaveBeenCalled();
      expect(repo.updateSettings).toHaveBeenCalledWith(1, {
        interfaceLang: "en", // changed — inferred from new native
        nativeLang: "en",
        learningLangs: ["cs"],
        lastSourceLang: null,
      });
    });

    it("back from step 3 returns to step 2 and completes with new choice", async () => {
      const { conversation, ctx } = setup([
        cb("lang:ru"), // Step 1
        cb("learn:cs"), // Step 2: select Czech
        cb("learn:done"),
        cb("level:back"), // Step 2.5: back → step 2
        cb("learn:de"), // Step 2 (again): select German
        cb("learn:done"),
        cb("level:de:C1"), // Step 2.5: proficiency
        txt("hello"), // Step 4: demo
      ]);

      await onboarding(conversation, ctx);

      expect(repo.markOnboarded).toHaveBeenCalled();
      // Last updateSettings call should have the new languages
      expect(repo.updateSettings).toHaveBeenLastCalledWith(1, {
        interfaceLang: "ru",
        nativeLang: "ru",
        learningLangs: ["de"], // changed on second pass
        lastSourceLang: null,
      });
    });

    it("supports multiple consecutive backs (3 → 2 → 1) and completes", async () => {
      const { conversation, ctx } = setup([
        cb("lang:ru"), // Step 1
        cb("learn:cs"), // Step 2
        cb("learn:done"),
        cb("level:back"), // Step 2.5: back → step 2
        cb("learn:back"), // Step 2: back → 1
        cb("lang:cs"), // Step 1 (again): pick Czech
        cb("learn:en"), // Step 2 (again): select English
        cb("learn:done"),
        cb("level:en:B1"), // Step 2.5: proficiency
        txt("world"), // Step 4 (demo)
      ]);

      await onboarding(conversation, ctx);

      expect(repo.markOnboarded).toHaveBeenCalled();
      expect(repo.updateSettings).toHaveBeenLastCalledWith(1, {
        interfaceLang: "cs",
        nativeLang: "cs",
        learningLangs: ["en"],
        lastSourceLang: null,
      });
    });

    it("back from step 2 resets learning language selection", async () => {
      const { conversation, ctx } = setup([
        cb("lang:ru"), // Step 1
        cb("learn:cs"), // Step 2: select Czech
        cb("learn:de"), // Step 2: select German
        cb("learn:back"), // Step 2: back (selection discarded)
        cb("lang:ru"), // Step 1 (again)
        cb("learn:fr"), // Step 2 (again): only French this time
        cb("learn:done"),
        cb("level:fr:A1"), // Step 2.5: proficiency
        txt("hello"),
      ]);

      await onboarding(conversation, ctx);

      expect(repo.updateSettings).toHaveBeenLastCalledWith(1, {
        interfaceLang: "ru",
        nativeLang: "ru",
        learningLangs: ["fr"], // previous cs+de selection was discarded
        lastSourceLang: null,
      });
    });
  });

  // ── DB call ordering during back navigation ──────────────────────────────

  describe("DB calls during back navigation", () => {
    it("does not call updateOnboardingStep when going back", async () => {
      const { conversation, ctx } = setup([
        cb("lang:en"), // Step 1: forward
        cb("learn:back"), // Step 2: back (no step-2 DB call)
        cb("lang:en"), // Step 1: forward (again)
        cb("learn:cs"),
        cb("learn:done"),
        cb("level:cs:B1"), // Step 2.5: proficiency
        txt("hello"),
      ]);

      await onboarding(conversation, ctx);

      // Step 1 completed twice, step 2 once
      expect(repo.updateOnboardingStep.mock.calls).toEqual([
        [1, 1],
        [1, 1],
        [1, 2],
      ]);
    });

    it("calls updateSettings again after back from step 2.5 and re-completing step 2", async () => {
      const { conversation, ctx } = setup([
        cb("lang:en"),
        cb("learn:cs"),
        cb("learn:done"), // first step 2 completion → updateSettings #1
        cb("level:back"), // Step 2.5: back → step 2
        cb("learn:de"),
        cb("learn:done"), // second step 2 completion → updateSettings #2
        cb("level:de:B2"), // Step 2.5: proficiency
        txt("hello"),
      ]);

      await onboarding(conversation, ctx);

      expect(repo.updateSettings).toHaveBeenCalledTimes(2);
      expect(repo.updateSettings).toHaveBeenNthCalledWith(1, 1, {
        interfaceLang: "en",
        nativeLang: "en",
        learningLangs: ["cs"],
        lastSourceLang: null,
      });
      expect(repo.updateSettings).toHaveBeenNthCalledWith(2, 1, {
        interfaceLang: "en",
        nativeLang: "en",
        learningLangs: ["de"],
        lastSourceLang: null,
      });
    });

    it("calls markOnboarded exactly once at the end", async () => {
      const { conversation, ctx } = setup([
        cb("lang:en"),
        cb("learn:back"), // back from step 2
        cb("lang:en"),
        cb("learn:cs"),
        cb("learn:done"),
        cb("level:back"), // back from step 2.5
        cb("learn:cs"),
        cb("learn:done"),
        cb("level:cs:B1"), // proficiency
        txt("hello"),
      ]);

      await onboarding(conversation, ctx);

      expect(repo.markOnboarded).toHaveBeenCalledTimes(1);
      expect(repo.markOnboarded).toHaveBeenCalledWith(1);
    });
  });

  // ── Back button presence in keyboards ────────────────────────────────────

  describe("back button presence in keyboards", () => {
    async function runFullFlow() {
      const harness = setup([cb("lang:ru"), cb("learn:cs"), cb("learn:done"), cb("level:cs:B1"), txt("hello")]);
      await onboarding(harness.conversation, harness.ctx);
      return harness.ctx;
    }

    it("step 1 keyboard does NOT have a back button", async () => {
      const ctx = await runFullFlow();
      // ctx.reply call [0] = step 1 prompt (native language)
      const kb = getKeyboard(ctx, 0);
      expect(hasButton(kb, "onb:back")).toBe(false);
      expect(hasButton(kb, "learn:back")).toBe(false);
    });

    it("step 2 keyboard HAS a back button", async () => {
      const ctx = await runFullFlow();
      // ctx.reply call [1] = step 2 prompt (learning languages)
      const kb = getKeyboard(ctx, 1);
      expect(hasButton(kb, "learn:back")).toBe(true);
    });

    it("step 4 (enter word) prompt HAS a back button", async () => {
      const ctx = await runFullFlow();
      // ctx.reply call [2] = step 2.5 proficiency level, [3] = step 4 "enter word" prompt
      const kb = getKeyboard(ctx, 3);
      expect(hasButton(kb, "onb:back")).toBe(true);
    });

    it("step 4 (demo result) does NOT have Save/Skip buttons", async () => {
      const ctx = await runFullFlow();
      // ctx.reply call [4] = step 4 translation result (no keyboard)
      const kb = getKeyboard(ctx, 4);
      expect(hasButton(kb, "demo:save")).toBe(false);
      expect(hasButton(kb, "demo:skip")).toBe(false);
    });
  });
});
