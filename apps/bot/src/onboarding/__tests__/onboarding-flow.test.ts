/**
 * Behaviour tests for the redesigned stateless onboarding flow (Task 72).
 *
 * These drive the real handlers against an in-memory repository so the state
 * transitions are genuine: a tap writes to the store, and the next tap re-derives
 * its screen from that store exactly as production does. That is what makes the
 * resumption and "never persisted without a level" guarantees testable at all —
 * they are properties of the stored state, not of a call sequence.
 */
import type { ServiceContainer } from "@polyglot/core";
import { GrammyError } from "grammy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServicesStub } from "../../test-helpers/services-stub.js";
import type { BotContext } from "../../types.js";
import {
  handleLegacyOnboardingCallback,
  handleOnboardingCallback,
  handleOnboardingText,
  onboardingTextMiddleware,
  startOnboarding,
} from "../onboarding-handlers.js";

vi.mock("@polyglot/infra", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../commands/commands.js", () => ({
  setUserCommands: vi.fn().mockResolvedValue(undefined),
}));

const { handleTranslateText } = vi.hoisted(() => ({ handleTranslateText: vi.fn() }));
vi.mock("../../scenes/helpers/translate-flow.js", () => ({ handleTranslateText }));

/**
 * The screencast file_id is a constant, not an environment variable — it is not a
 * secret and never varies between environments. A getter over a hoisted holder
 * lets a test set it without turning the production code into a config lookup.
 */
const { screencast } = vi.hoisted(() => ({ screencast: { fileId: "" } }));
vi.mock("../../constants.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../constants.js")>()),
  get ONBOARDING_SCREENCAST_FILE_ID() {
    return screencast.fileId;
  },
}));

const { handleDictionaryCommand, handleReviewCommand, handleVideosCommand, handleSettingsCommand } = vi.hoisted(() => ({
  handleDictionaryCommand: vi.fn(),
  handleReviewCommand: vi.fn(),
  handleVideosCommand: vi.fn(),
  handleSettingsCommand: vi.fn(),
}));
vi.mock("../../scenes/dictionary.scene.js", () => ({ handleDictionaryCommand }));
vi.mock("../../scenes/srs.scene.js", () => ({ handleReviewCommand }));
vi.mock("../../scenes/helpers/video-vocabulary.helper.js", () => ({ handleVideosCommand }));
vi.mock("../../scenes/settings.scene.js", () => ({ handleSettingsCommand }));

const LANGS = [
  { code: "ru", name: "Russian", nativeName: "Русский", flag: "🇷🇺" },
  { code: "en", name: "English", nativeName: "English", flag: "🇬🇧" },
  { code: "cs", name: "Czech", nativeName: "Čeština", flag: "🇨🇿" },
  { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪" },
  { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷" },
  { code: "es", name: "Spanish", nativeName: "Español", flag: "🇪🇸" },
];

/** Shaped like real de→ru pipeline output: the headword lives in `sourceUsage`. */
const DEMO_PAYLOAD = {
  original: "Backpfeifengesicht",
  sourceLang: "de",
  nativeSynonyms: [],
  sourceUsage: {
    headword: "Backpfeifengesicht",
    explanation: "лицо, которое так и просит пощёчины",
    synonyms: [],
    examples: [],
  },
  translations: {
    ru: { text: "лицо, которое хочется ударить", synonyms: [], examples: [] },
  },
};

interface KeyboardButton {
  text: string;
  callback_data?: string;
}

type Keyboard = KeyboardButton[][];

function createHarness(opts: { languageCode?: string } = {}) {
  const store = {
    user: {
      id: 1,
      audienceGroup: "product" as const,
      subscriptionPlan: "free",
      onboarded: false,
      onboardingStep: 0,
      isActive: true,
    },
    settings: null as null | { interfaceLang: string; nativeLang: string; learningLangs: string[] },
    levels: [] as Array<{ languageCode: string; proficiencyLevel: string }>,
  };

  const userRepository = {
    getSettings: vi.fn(async () => store.settings),
    getLanguageLevels: vi.fn(async () => store.levels),
    updateSettings: vi.fn(async (_id: number, settings: Record<string, unknown>) => {
      store.settings = { ...(store.settings ?? {}), ...settings } as typeof store.settings;
      return store.settings;
    }),
    setLanguageLevel: vi.fn(async (_id: number, code: string, level: string) => {
      const existing = store.levels.find((row) => row.languageCode === code);
      if (existing) existing.proficiencyLevel = level;
      else store.levels.push({ languageCode: code, proficiencyLevel: level });
    }),
    updateOnboardingStep: vi.fn(async (_id: number, step: number) => {
      store.user.onboardingStep = step;
      return store.user;
    }),
    markOnboarded: vi.fn(async () => {
      store.user.onboarded = true;
      store.user.onboardingStep = 4;
      return store.user;
    }),
    updateActiveMode: vi.fn().mockResolvedValue({}),
  };

  const onboardingDemoCardRepository = {
    findActive: vi.fn().mockResolvedValue([]),
    findOne: vi.fn().mockResolvedValue(null),
    hasCached: vi.fn().mockResolvedValue(false),
    upsert: vi.fn().mockResolvedValue(undefined),
  };

  const languageCache = {
    getSupportedLangs: () => LANGS,
    getLangDisplay: (code: string) => {
      const entry = LANGS.find((l) => l.code === code);
      return entry ? `${entry.flag} ${entry.nativeName}` : code;
    },
    getLangFlag: (code: string) => LANGS.find((l) => l.code === code)?.flag,
  };

  const ai = {
    generateObject: vi.fn(() => {
      throw new Error("AI must not be called on the cached hook path");
    }),
    generateText: vi.fn(() => {
      throw new Error("AI must not be called on the cached hook path");
    }),
    generateChat: vi.fn(),
  };

  const ctx = {
    from: { id: 555, language_code: opts.languageCode },
    chat: { id: 555 },
    user: store.user,
    session: { activeMode: "idle", translationMap: {}, technicalMessages: [] },
    api: { editMessageReplyMarkup: vi.fn().mockResolvedValue(true), deleteMessage: vi.fn().mockResolvedValue(true) },
    reply: vi.fn(async () => ({ message_id: 900 })),
    replyWithAnimation: vi.fn().mockResolvedValue({ message_id: 901 }),
    editMessageText: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    callbackQuery: undefined as undefined | { data: string },
    message: undefined as undefined | { text: string },
    services: createServicesStub({
      userRepository: userRepository as unknown as ServiceContainer["userRepository"],
      onboardingDemoCardRepository:
        onboardingDemoCardRepository as unknown as ServiceContainer["onboardingDemoCardRepository"],
      languageCache: languageCache as unknown as ServiceContainer["languageCache"],
      ai: ai as unknown as ServiceContainer["ai"],
    }),
  } as unknown as BotContext;

  const mutableCtx = ctx as unknown as {
    callbackQuery?: { data: string };
    message?: { text: string };
  };

  const mutableSession = ctx.session as unknown as {
    pendingCardMsgId?: number;
    pendingTranslation?: unknown;
    pendingClarification?: unknown;
  };

  /**
   * Default translate behaviour: render a card, exactly as the production flow
   * does — it advances `session.pendingCardMsgId` and leaves the output on
   * `session.pendingTranslation`. Onboarding keys its completion off that, so a
   * mock that skipped it would let a test pass against behaviour the real bot
   * cannot produce.
   */
  handleTranslateText.mockReset();
  handleTranslateText.mockImplementation(async (_ctx: unknown, text: string) => {
    mutableSession.pendingCardMsgId = (mutableSession.pendingCardMsgId ?? 900) + 1;
    mutableSession.pendingTranslation = { ...DEMO_PAYLOAD, original: text };
  });

  /** Simulate a translate call that renders nothing and asks the user something. */
  function translateAsksQuestion(): void {
    handleTranslateText.mockImplementation(async () => {
      mutableSession.pendingClarification = { word: "doch", options: [] };
    });
  }

  /** Simulate a translate call that refuses the input outright (emoji, quota, …). */
  function translateRefusesInput(): void {
    handleTranslateText.mockImplementation(async () => {});
  }

  /** Restore the default: a translate call that renders a card. */
  function translateRendersCard(): void {
    handleTranslateText.mockImplementation(async (_ctx: unknown, text: string) => {
      mutableSession.pendingCardMsgId = (mutableSession.pendingCardMsgId ?? 900) + 1;
      mutableSession.pendingTranslation = { ...DEMO_PAYLOAD, original: text };
    });
  }

  /** Simulate a button tap. */
  async function tap(data: string): Promise<void> {
    mutableCtx.callbackQuery = { data };
    mutableCtx.message = undefined;
    await handleOnboardingCallback(ctx);
  }

  /** Simulate a plain text message. */
  async function send(text: string): Promise<boolean> {
    mutableCtx.callbackQuery = undefined;
    mutableCtx.message = { text };
    return handleOnboardingText(ctx, text);
  }

  /** Simulate `/start`. */
  async function start(): Promise<void> {
    mutableCtx.callbackQuery = undefined;
    mutableCtx.message = { text: "/start" };
    await startOnboarding(ctx);
  }

  /** The keyboard of the most recent screen, whether it was sent or edited. */
  function currentKeyboard(): Keyboard {
    const editCalls = vi.mocked(ctx.editMessageText).mock.calls;
    const replyCalls = vi.mocked(ctx.reply).mock.calls;
    const last = editCalls.length > 0 ? editCalls.at(-1) : replyCalls.at(-1);
    const options = last?.[1] as { reply_markup?: { inline_keyboard?: Keyboard } } | undefined;
    return options?.reply_markup?.inline_keyboard ?? [];
  }

  /** The text of the most recent screen. */
  function currentText(): string {
    const editCalls = vi.mocked(ctx.editMessageText).mock.calls;
    const replyCalls = vi.mocked(ctx.reply).mock.calls;
    const last = editCalls.length > 0 ? editCalls.at(-1) : replyCalls.at(-1);
    return String(last?.[0] ?? "");
  }

  function callbackData(keyboard: Keyboard = currentKeyboard()): string[] {
    return keyboard
      .flat()
      .map((button) => button.callback_data)
      .filter((data): data is string => typeof data === "string");
  }

  return {
    ctx,
    store,
    userRepository,
    onboardingDemoCardRepository,
    ai,
    tap,
    send,
    start,
    currentKeyboard,
    currentText,
    callbackData,
    translateAsksQuestion,
    translateRefusesInput,
    translateRendersCard,
  };
}

/** Walk the happy path up to (but not including) the demo screen. */
async function reachDemoScreen(h: ReturnType<typeof createHarness>): Promise<void> {
  await h.start();
  await h.tap("onb:nat:ru");
  await h.tap("onb:lang:de");
  await h.tap("onb:lvl:de:B1");
  await h.tap("onb:done");
}

describe("onboarding — screen 0 (native language)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("puts the language guessed from the Telegram locale first, above the full list", async () => {
    const h = createHarness({ languageCode: "ru" });

    await h.start();

    const data = h.callbackData();
    expect(data[0]).toBe("onb:nat:ru");
    // Every other language is on the same screen — no "another language" step.
    expect(new Set(data)).toEqual(new Set(LANGS.map((l) => `onb:nat:${l.code}`)));
  });

  it("spells out what the guessed language means, rather than a bare Yes", async () => {
    const h = createHarness({ languageCode: "ru" });

    await h.start();

    // The guess reports the Telegram *interface* language, which for an expat is
    // not their mother tongue — so the button has to say what tapping it claims.
    const first = h.currentKeyboard()[0][0];
    expect(first.callback_data).toBe("onb:nat:ru");
    expect(first.text).toContain("Русский");
    expect(first.text.length).toBeGreaterThan("🇷🇺 Русский".length);
  });

  it("never lists the guessed language twice", async () => {
    const h = createHarness({ languageCode: "ru" });

    await h.start();

    const data = h.callbackData();
    expect(data.filter((entry) => entry === "onb:nat:ru")).toHaveLength(1);
  });

  it("normalises a regional locale to its base language", async () => {
    const h = createHarness({ languageCode: "en-US" });

    await h.start();

    expect(h.callbackData()[0]).toBe("onb:nat:en");
  });

  it("shows the plain list when the locale is missing, with nothing promoted", async () => {
    const h = createHarness();

    await h.start();

    expect(h.callbackData()).toEqual(LANGS.map((l) => `onb:nat:${l.code}`));
  });

  it("shows the plain list when the locale is not a language we support", async () => {
    const h = createHarness({ languageCode: "ja" });

    await h.start();

    expect(h.callbackData()).toEqual(LANGS.map((l) => `onb:nat:${l.code}`));
  });

  it("offers the same set of languages whether or not the locale was guessable", async () => {
    const guessed = createHarness({ languageCode: "ru" });
    await guessed.start();
    const blind = createHarness();
    await blind.start();

    expect(new Set(guessed.callbackData())).toEqual(new Set(blind.callbackData()));
  });

  it("lays the picker out in two columns", async () => {
    const h = createHarness();

    await h.start();

    for (const row of h.currentKeyboard()) {
      expect(row.length).toBeLessThanOrEqual(2);
    }
    expect(h.currentKeyboard().some((row) => row.length === 2)).toBe(true);
  });

  it("persists the chosen native language and the inferred interface language immediately", async () => {
    const h = createHarness({ languageCode: "ru" });
    await h.start();

    await h.tap("onb:nat:ru");

    expect(h.store.settings).toMatchObject({ nativeLang: "ru", interfaceLang: "ru", learningLangs: [] });
  });
});

describe("onboarding — screen 1 (languages with inline CEFR)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hides the native language from the learning list and uses two columns", async () => {
    const h = createHarness({ languageCode: "ru" });
    await h.start();

    await h.tap("onb:nat:ru");

    expect(h.callbackData()).not.toContain("onb:lang:ru");
    for (const row of h.currentKeyboard()) {
      expect(row.length).toBeLessThanOrEqual(2);
    }
  });

  it("expands a compact one-row level selector in the same message when a language is tapped", async () => {
    const h = createHarness({ languageCode: "ru" });
    await h.start();
    await h.tap("onb:nat:ru");
    const repliesBefore = vi.mocked(h.ctx.reply).mock.calls.length;

    await h.tap("onb:lang:de");

    // Same message, no new screen.
    expect(vi.mocked(h.ctx.reply).mock.calls.length).toBe(repliesBefore);
    const keyboard = h.currentKeyboard();
    expect(keyboard[0].map((b) => b.text)).toEqual(["A1", "A2", "B1", "B2", "C1", "C2"]);
    expect(h.callbackData()).toContain("onb:lvl:de:unknown");
    // The long CEFR wording lives in the prompt, not on the buttons.
    expect(h.currentText()).toContain("A1");
  });

  it("collapses back to the language list as a confirmed chip once a level is picked", async () => {
    const h = createHarness({ languageCode: "ru" });
    await h.start();
    await h.tap("onb:nat:ru");
    await h.tap("onb:lang:de");

    await h.tap("onb:lvl:de:B2");

    expect(h.userRepository.setLanguageLevel).toHaveBeenCalledWith(1, "de", "B2");
    expect(h.store.settings?.learningLangs).toEqual(["de"]);
    expect(h.currentText()).toContain("· B2");
    expect(h.currentKeyboard()[0].map((b) => b.text)).not.toEqual(["A1", "A2", "B1", "B2", "C1", "C2"]);
    expect(
      h
        .currentKeyboard()
        .flat()
        .map((b) => b.text),
    ).toContainEqual(expect.stringContaining("· B2"));
  });

  it("persists the B1 default for '🤷 I don't know', indistinguishably from an explicit B1", async () => {
    const shrug = createHarness({ languageCode: "ru" });
    await shrug.start();
    await shrug.tap("onb:nat:ru");
    await shrug.tap("onb:lang:de");
    await shrug.tap("onb:lvl:de:unknown");

    const explicit = createHarness({ languageCode: "ru" });
    await explicit.start();
    await explicit.tap("onb:nat:ru");
    await explicit.tap("onb:lang:de");
    await explicit.tap("onb:lvl:de:B1");

    expect(shrug.userRepository.setLanguageLevel).toHaveBeenCalledWith(1, "de", "B1");
    expect(shrug.store.levels).toEqual(explicit.store.levels);
    expect(shrug.store.settings?.learningLangs).toEqual(explicit.store.settings?.learningLangs);
  });

  it("never persists a learning language without a level", async () => {
    const h = createHarness({ languageCode: "ru" });
    await h.start();
    await h.tap("onb:nat:ru");

    // Tapping the language only opens its level row.
    await h.tap("onb:lang:de");

    expect(h.store.settings?.learningLangs).toEqual([]);
    expect(h.userRepository.setLanguageLevel).not.toHaveBeenCalled();
  });

  it("offers Done only once at least one language carries a level", async () => {
    const h = createHarness({ languageCode: "ru" });
    await h.start();
    await h.tap("onb:nat:ru");
    expect(h.callbackData()).not.toContain("onb:done");

    await h.tap("onb:lang:de");
    await h.tap("onb:lvl:de:B1");

    expect(h.callbackData()).toContain("onb:done");
  });

  it("re-opens the level row for a confirmed language, offering a change or a removal", async () => {
    const h = createHarness({ languageCode: "ru" });
    await h.start();
    await h.tap("onb:nat:ru");
    await h.tap("onb:lang:de");
    await h.tap("onb:lvl:de:B1");

    await h.tap("onb:lang:de");

    expect(h.callbackData()).toContain("onb:lvl:de:C1");
    expect(h.callbackData()).toContain("onb:lvl:de:remove");
  });

  it("deselects a language on removal, dropping it from the persisted set", async () => {
    const h = createHarness({ languageCode: "ru" });
    await h.start();
    await h.tap("onb:nat:ru");
    await h.tap("onb:lang:de");
    await h.tap("onb:lvl:de:B1");

    await h.tap("onb:lang:de");
    await h.tap("onb:lvl:de:remove");

    expect(h.store.settings?.learningLangs).toEqual([]);
    expect(h.callbackData()).not.toContain("onb:done");
    expect(
      h
        .currentKeyboard()
        .flat()
        .map((b) => b.text),
    ).not.toContainEqual(expect.stringContaining("· B1"));
  });

  it("takes four languages on a single screen and persists all four levels", async () => {
    const h = createHarness({ languageCode: "ru" });
    await h.start();
    await h.tap("onb:nat:ru");
    const repliesBefore = vi.mocked(h.ctx.reply).mock.calls.length;

    for (const [code, level] of [
      ["de", "A1"],
      ["en", "B2"],
      ["cs", "C1"],
      ["fr", "B1"],
    ]) {
      await h.tap(`onb:lang:${code}`);
      await h.tap(`onb:lvl:${code}:${level}`);
    }

    expect(h.store.settings?.learningLangs).toEqual(["de", "en", "cs", "fr"]);
    expect(h.store.levels).toEqual([
      { languageCode: "de", proficiencyLevel: "A1" },
      { languageCode: "en", proficiencyLevel: "B2" },
      { languageCode: "cs", proficiencyLevel: "C1" },
      { languageCode: "fr", proficiencyLevel: "B1" },
    ]);
    // Eight taps, still no second screen.
    expect(vi.mocked(h.ctx.reply).mock.calls.length).toBe(repliesBefore);
  });

  it("refuses a fifth language with an alert instead of silently dropping it", async () => {
    const h = createHarness({ languageCode: "ru" });
    await h.start();
    await h.tap("onb:nat:ru");
    for (const code of ["de", "en", "cs", "fr"]) {
      await h.tap(`onb:lang:${code}`);
      await h.tap(`onb:lvl:${code}:B1`);
    }

    await h.tap("onb:lang:es");

    expect(h.ctx.answerCallbackQuery).toHaveBeenLastCalledWith(expect.objectContaining({ show_alert: true }));
    expect(h.store.settings?.learningLangs).toHaveLength(4);
  });

  it("rejects Done while nothing has a level", async () => {
    const h = createHarness({ languageCode: "ru" });
    await h.start();
    await h.tap("onb:nat:ru");

    await h.tap("onb:done");

    expect(h.ctx.answerCallbackQuery).toHaveBeenLastCalledWith(expect.objectContaining({ show_alert: true }));
    expect(h.userRepository.markOnboarded).not.toHaveBeenCalled();
  });
});

describe("onboarding — screen 2 (instant demo card)", () => {
  beforeEach(() => vi.clearAllMocks());

  const CACHED = {
    id: 7,
    sourceLang: "de",
    nativeLang: "ru",
    headword: "Backpfeifengesicht",
    sortOrder: 0,
    isActive: true,
    createdAt: new Date(0),
    payload: DEMO_PAYLOAD,
  };

  it("offers a tappable hook word per learning language and requires no typing", async () => {
    const h = createHarness({ languageCode: "ru" });

    await reachDemoScreen(h);

    const hooks = h.callbackData().filter((data) => data.startsWith("onb:hook:de:"));
    expect(hooks.length).toBeGreaterThan(0);
  });

  it("renders a cached card without ever touching the AI port", async () => {
    const h = createHarness({ languageCode: "ru" });
    await reachDemoScreen(h);
    h.onboardingDemoCardRepository.findOne.mockResolvedValue(CACHED);

    await h.tap("onb:hook:de:0");

    expect(h.onboardingDemoCardRepository.findOne).toHaveBeenCalledWith("de", "ru", expect.any(String));
    expect(h.ai.generateObject).not.toHaveBeenCalled();
    expect(h.ai.generateText).not.toHaveBeenCalled();
    expect(handleTranslateText).not.toHaveBeenCalled();
    const card = vi.mocked(h.ctx.reply).mock.calls.find(([text]) => String(text).includes("Backpfeifengesicht"));
    expect(card).toBeDefined();
    expect(h.userRepository.markOnboarded).toHaveBeenCalledWith(1);
  });

  it("does not cache a payload the pipeline did not actually produce for the hook word", async () => {
    const h = createHarness({ languageCode: "ru" });
    await reachDemoScreen(h);
    h.onboardingDemoCardRepository.findOne.mockResolvedValue(null);
    handleTranslateText.mockImplementation(async () => {
      // A card IS rendered, but for a different headword than the button asked
      // for (a mistype confirmation re-translated something else). Caching it
      // under the curated headword would poison the cache.
      (h.ctx.session as unknown as { pendingCardMsgId: number }).pendingCardMsgId = 950;
      (h.ctx.session as unknown as { pendingTranslation: unknown }).pendingTranslation = {
        ...DEMO_PAYLOAD,
        original: "etwas ganz anderes",
      };
    });

    await h.tap("onb:hook:de:0");

    expect(h.onboardingDemoCardRepository.upsert).not.toHaveBeenCalled();
  });

  it("runs the live pipeline exactly once on a cache miss and writes the result back", async () => {
    const h = createHarness({ languageCode: "ru" });
    await reachDemoScreen(h);
    h.onboardingDemoCardRepository.findOne.mockResolvedValue(null);

    await h.tap("onb:hook:de:0");

    expect(handleTranslateText).toHaveBeenCalledTimes(1);
    expect(h.onboardingDemoCardRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ sourceLang: "de", nativeLang: "ru", payload: CACHED.payload }),
    );
  });

  it("never serves an unreviewed card — an inactive row reads as a miss", async () => {
    const h = createHarness({ languageCode: "ru" });
    await reachDemoScreen(h);
    // The repository filters `is_active`, so an unreviewed row surfaces as null.
    h.onboardingDemoCardRepository.findOne.mockResolvedValue(null);

    await h.tap("onb:hook:de:0");

    const rendered = vi
      .mocked(h.ctx.reply)
      .mock.calls.some(([text]) => String(text).includes("лицо, которое хочется ударить"));
    expect(rendered).toBe(false);
    expect(handleTranslateText).toHaveBeenCalledTimes(1);
  });

  it("runs the real translate path for a typed word and completes onboarding", async () => {
    const h = createHarness({ languageCode: "ru" });
    await reachDemoScreen(h);

    const handled = await h.send("Katze");

    expect(handled).toBe(true);
    expect(handleTranslateText).toHaveBeenCalledWith(h.ctx, "Katze");
    expect(h.userRepository.markOnboarded).toHaveBeenCalledWith(1);
    expect(h.userRepository.updateActiveMode).toHaveBeenCalledWith(1, "translate");
  });

  it("apologises but still completes onboarding when the demo pipeline fails", async () => {
    const h = createHarness({ languageCode: "ru" });
    await reachDemoScreen(h);
    handleTranslateText.mockRejectedValue(new Error("model unavailable"));

    await h.send("Katze");

    const apology = vi.mocked(h.ctx.reply).mock.calls.map(([text]) => String(text));
    expect(apology.some((text) => text.length > 0)).toBe(true);
    expect(h.userRepository.markOnboarded).toHaveBeenCalledWith(1);
  });

  it("does not bury a clarification question under the completion screen", async () => {
    const h = createHarness({ languageCode: "ru" });
    await reachDemoScreen(h);
    h.translateAsksQuestion();
    const repliesBefore = vi.mocked(h.ctx.reply).mock.calls.length;

    await h.send("doch");

    // The pipeline asked the user which meaning they wanted. Completing here
    // would sweep the question away and mark them onboarded having never seen a
    // card — the exact payoff the redesign exists to deliver.
    expect(h.userRepository.markOnboarded).not.toHaveBeenCalled();
    expect(vi.mocked(h.ctx.reply).mock.calls.length).toBe(repliesBefore);
  });

  it("still completes when no card came back, so an outage cannot strand the user", async () => {
    const h = createHarness({ languageCode: "ru" });
    await reachDemoScreen(h);
    // `handleTranslateText` catches its own errors and replies, so a model outage
    // returns normally with no card rather than throwing. Refusing to complete
    // here would leave every new user stuck in onboarding for the outage.
    h.translateRefusesInput();

    await h.send("Katze");

    expect(h.userRepository.markOnboarded).toHaveBeenCalledWith(1);
  });

  it("re-renders the current screen instead of translating when text arrives before the demo", async () => {
    const h = createHarness({ languageCode: "ru" });
    await h.start();
    await h.tap("onb:nat:ru");

    const handled = await h.send("hello");

    expect(handled).toBe(true);
    expect(handleTranslateText).not.toHaveBeenCalled();
    expect(h.userRepository.markOnboarded).not.toHaveBeenCalled();
  });
});

describe("onboarding — screen 3 (instruction + feature entry points)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("closes on one message that carries the mode menu, with no inline copy of it", async () => {
    const h = createHarness({ languageCode: "ru" });
    await reachDemoScreen(h);
    h.onboardingDemoCardRepository.findOne.mockResolvedValue(null);

    await h.tap("onb:hook:de:0");

    // The closing screen used to be two messages — inline feature buttons, then a
    // second message repeating the same modes in prose to deliver the keyboard.
    const closing = vi.mocked(h.ctx.reply).mock.calls.at(-1);
    const markup = closing?.[1] as {
      reply_markup?: { inline_keyboard?: Keyboard; one_time_keyboard?: boolean };
    };
    expect(markup?.reply_markup?.inline_keyboard).toBeUndefined();
    expect(markup?.reply_markup).toMatchObject({ one_time_keyboard: true });
    // The instructions and the hand-off are the same message now.
    expect(String(closing?.[0])).toContain("Готово");
    expect(String(closing?.[0])).not.toContain("/translate");
  });

  it("names the icon that brings the folded-away menu back", async () => {
    const h = createHarness({ languageCode: "ru" });
    await reachDemoScreen(h);
    h.onboardingDemoCardRepository.findOne.mockResolvedValue(null);

    await h.tap("onb:hook:de:0");

    // The menu is not pinned to the screen, so onboarding is the one place the
    // user is shown it — a hand-off that never names the icon leaves a keyboard
    // that folds away after one use effectively undiscoverable.
    expect(String(vi.mocked(h.ctx.reply).mock.calls.at(-1)?.[0])).toContain("⌨️");
  });

  it("routes each feature button to the existing scene handler", async () => {
    const h = createHarness({ languageCode: "ru" });
    h.store.user.onboarded = true;

    await h.tap("onb:go:dictionary");
    await h.tap("onb:go:training");
    await h.tap("onb:go:video");
    await h.tap("onb:go:settings");

    expect(handleDictionaryCommand).toHaveBeenCalledWith(h.ctx);
    expect(handleReviewCommand).toHaveBeenCalledWith(h.ctx);
    expect(handleVideosCommand).toHaveBeenCalledWith(h.ctx);
    expect(handleSettingsCommand).toHaveBeenCalledWith(h.ctx);
  });

  it("sends the screencast only when an asset is configured, and never fails on its absence", async () => {
    const h = createHarness({ languageCode: "ru" });
    await reachDemoScreen(h);

    await h.tap("onb:hook:de:0");

    expect(h.ctx.replyWithAnimation).not.toHaveBeenCalled();
    expect(h.userRepository.markOnboarded).toHaveBeenCalled();
  });

  it("sends the screencast when a file id is configured", async () => {
    screencast.fileId = "BAADBAADrwADBREAAYag";
    try {
      const h = createHarness({ languageCode: "ru" });
      await reachDemoScreen(h);

      await h.tap("onb:hook:de:0");

      expect(h.ctx.replyWithAnimation).toHaveBeenCalledWith("BAADBAADrwADBREAAYag");
    } finally {
      screencast.fileId = "";
    }
  });

  it("still delivers the instruction screen when the screencast fails to send", async () => {
    screencast.fileId = "stale-file-id";
    try {
      const h = createHarness({ languageCode: "ru" });
      await reachDemoScreen(h);
      vi.mocked(h.ctx.replyWithAnimation).mockRejectedValue(new Error("wrong file identifier"));

      await h.tap("onb:hook:de:0");

      expect(h.userRepository.markOnboarded).toHaveBeenCalledWith(1);
      const final = vi.mocked(h.ctx.reply).mock.calls.at(-1);
      expect(final).toBeDefined();
    } finally {
      screencast.fileId = "";
    }
  });
});

describe("onboarding — statelessness and instrumentation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resumes on the furthest screen reached, however long the gap between taps", async () => {
    const h = createHarness({ languageCode: "ru" });
    await h.start();
    await h.tap("onb:nat:ru");
    await h.tap("onb:lang:de");
    await h.tap("onb:lvl:de:B1");

    // An arbitrary pause changes nothing: the next update re-derives its screen
    // from the database. `/start` must not restart from the native question.
    await h.start();

    expect(h.callbackData()).not.toContain("onb:nat:ru");
    expect(h.callbackData()).toContain("onb:done");
  });

  it("resumes on the demo screen once the language step is done", async () => {
    const h = createHarness({ languageCode: "ru" });
    await reachDemoScreen(h);

    await h.start();

    expect(h.callbackData().some((data) => data.startsWith("onb:hook:"))).toBe(true);
  });

  it("keeps every button live after an arbitrary pause — a stale tap is still handled", async () => {
    const h = createHarness({ languageCode: "ru" });
    await h.start();
    await h.tap("onb:nat:ru");
    await h.tap("onb:lang:de");

    // The tap that a timed-out conversation used to drop.
    await h.tap("onb:lvl:de:B1");

    expect(h.userRepository.setLanguageLevel).toHaveBeenCalledWith(1, "de", "B1");
    expect(h.ctx.answerCallbackQuery).toHaveBeenCalled();
  });

  it("records a step for every screen, and never rewinds the furthest step reached", async () => {
    const h = createHarness({ languageCode: "ru" });

    await h.start();
    expect(h.userRepository.updateOnboardingStep).toHaveBeenCalledWith(1, 1);

    await h.tap("onb:nat:ru");
    expect(h.userRepository.updateOnboardingStep).toHaveBeenCalledWith(1, 2);

    await h.tap("onb:lang:de");
    await h.tap("onb:lvl:de:B1");
    await h.tap("onb:done");
    expect(h.userRepository.updateOnboardingStep).toHaveBeenCalledWith(1, 3);

    // Re-opening an earlier screen must not move the funnel backwards.
    const steps = h.userRepository.updateOnboardingStep.mock.calls.map(([, step]) => step);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });

  it("reaches the first real card in five taps from /start", async () => {
    const h = createHarness({ languageCode: "ru" });
    h.onboardingDemoCardRepository.findOne.mockResolvedValue(null);

    await h.start();
    const taps = ["onb:nat:ru", "onb:lang:de", "onb:lvl:de:B1", "onb:done", "onb:hook:de:0"];
    for (const data of taps) {
      await h.tap(data);
    }

    expect(taps).toHaveLength(5);
    expect(h.userRepository.markOnboarded).toHaveBeenCalledWith(1);
  });

  it("passes text through to the rest of the chain when another flow is waiting on it", async () => {
    const h = createHarness({ languageCode: "ru" });
    await reachDemoScreen(h);
    // /settings and /dictionary are not blocked during onboarding, so their
    // wizards can legitimately be mid-question. Consuming that answer here would
    // hang them exactly the way the old conversation hung the whole chat.
    (h.ctx.session as unknown as { dictionaryWizard: unknown }).dictionaryWizard = { step: "name" };
    const next = vi.fn().mockResolvedValue(undefined);
    (h.ctx as unknown as { message?: { text: string } }).message = { text: "My words" };

    await onboardingTextMiddleware(h.ctx, next);

    expect(next).toHaveBeenCalled();
    expect(handleTranslateText).not.toHaveBeenCalled();
  });

  it("consumes demo-screen text itself when no other flow is waiting", async () => {
    const h = createHarness({ languageCode: "ru" });
    await reachDemoScreen(h);
    const next = vi.fn().mockResolvedValue(undefined);
    (h.ctx as unknown as { message?: { text: string } }).message = { text: "Katze" };

    await onboardingTextMiddleware(h.ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(handleTranslateText).toHaveBeenCalledWith(h.ctx, "Katze");
  });

  it("ignores an onboarding tap from a user who has already finished", async () => {
    const h = createHarness({ languageCode: "ru" });
    h.store.user.onboarded = true;

    await h.tap("onb:lang:de");

    expect(h.ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(h.userRepository.setLanguageLevel).not.toHaveBeenCalled();
    expect(h.ctx.editMessageText).not.toHaveBeenCalled();
  });
});

describe("onboarding — recovery and reversibility", () => {
  beforeEach(() => vi.clearAllMocks());

  it("puts a tap on a pre-Task-72 keyboard back onto a live screen", async () => {
    const h = createHarness({ languageCode: "ru" });
    await h.start();
    await h.tap("onb:nat:ru");
    vi.mocked(h.ctx.editMessageText).mockClear();

    // A keyboard rendered by the old conversation flow, still on screen after the
    // deploy. Its prefix is produced by nothing now; unanswered, the button spins
    // forever — the 2026-08-01 incident.
    (h.ctx as unknown as { callbackQuery?: { data: string } }).callbackQuery = { data: "learn:de" };
    await handleLegacyOnboardingCallback(h.ctx);

    expect(h.ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(h.ctx.editMessageText).toHaveBeenCalled();
    expect(h.callbackData()).toContain("onb:lang:de");
  });

  it("acknowledges a legacy tap from an already-onboarded user without re-rendering", async () => {
    const h = createHarness({ languageCode: "ru" });
    h.store.user.onboarded = true;
    (h.ctx as unknown as { callbackQuery?: { data: string } }).callbackQuery = { data: "lang:ru" };

    await handleLegacyOnboardingCallback(h.ctx);

    expect(h.ctx.answerCallbackQuery).toHaveBeenCalled();
    expect(h.ctx.editMessageText).not.toHaveBeenCalled();
  });

  it("lets the user take back a wrongly guessed native language", async () => {
    // en-US phone, Russian speaker: the one-tap guess decides the interface
    // language for every screen after it, so it has to be reversible.
    const h = createHarness({ languageCode: "en-US" });
    await h.start();
    await h.tap("onb:nat:en");
    expect(h.store.settings?.nativeLang).toBe("en");
    expect(h.callbackData()).toContain("onb:back:native");

    await h.tap("onb:back:native");
    await h.tap("onb:nat:ru");

    expect(h.store.settings).toMatchObject({ nativeLang: "ru", interfaceLang: "ru" });
    expect(h.callbackData()).not.toContain("onb:lang:ru");
  });

  it("drops a learning language that becomes the native language on a back-and-change", async () => {
    const h = createHarness({ languageCode: "en-US" });
    await h.start();
    await h.tap("onb:nat:en");
    await h.tap("onb:lang:ru");
    await h.tap("onb:lvl:ru:B1");
    expect(h.store.settings?.learningLangs).toEqual(["ru"]);

    await h.tap("onb:back:native");
    await h.tap("onb:nat:ru");

    // Russian cannot be both the native language and a language being learned.
    expect(h.store.settings?.learningLangs).toEqual([]);
  });

  it("tracks the replacement message when a screen is too old to edit", async () => {
    const h = createHarness({ languageCode: "ru" });
    await h.start();

    // Past Telegram's 48-hour edit window the shared helper sends a fresh message
    // instead. Onboarding is built to survive multi-day pauses, so this is a real
    // path — and an untracked prompt can never be swept at completion.
    const tooOld = new GrammyError(
      "Call to 'editMessageText' failed!",
      { ok: false, error_code: 400, description: "Bad Request: message to edit not found" },
      "editMessageText",
      {},
    );
    vi.mocked(h.ctx.editMessageText).mockRejectedValueOnce(tooOld);
    vi.mocked(h.ctx.reply).mockResolvedValueOnce({ message_id: 4242 } as never);

    await h.tap("onb:nat:ru");

    expect(h.ctx.session.technicalMessages).toContain(4242);
  });
});
