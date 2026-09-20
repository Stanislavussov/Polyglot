/**
 * The closing onboarding screen.
 *
 * The screen's whole promise is that it cannot go stale, so these tests are
 * written against the sources it derives from rather than against its wording:
 * they add a button to the card and expect the description to follow, rename a
 * plan in the catalog and expect the announcement to follow. A test that pinned
 * the finished sentence would pass on exactly the day the screen started lying.
 */
import { type ServiceContainer, type SupportedLang, TRIAL_EXTENSION_WORDS, t } from "@polyglot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTranslationKeyboard } from "../../renderers/translation.renderer.js";
import { createServicesStub } from "../../test-helpers/services-stub.js";
import type { BotContext } from "../../types.js";
import { NOOP_CALLBACK } from "../../utils/long-op.js";
import { mainMenuEntries } from "../../utils/main-menu.js";
import {
  buildClosingText,
  CARD_BUTTON_HINTS,
  CLOSING_SCREEN_DELAY_MS,
  flushScheduledClosings,
  scheduleClosingScreen,
} from "../closing-screen.js";
import type { OnboardingState } from "../onboarding-state.js";

vi.mock("@polyglot/infra", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

/** The catalog as the admin panel owns it — a free tier and the tier the trial grants. */
const PLAN_CATALOG = [
  {
    name: "free",
    label: "Free",
    translationLimit: 30,
    creditCost: 1,
    videoLimit: 0,
    videoWindow: "none" as const,
    mentorDailyLimit: null,
    dailyCreditCeiling: null,
    priceUsdCents: null,
    isActive: true,
    isDefault: true,
  },
  {
    name: "pro",
    label: "Pro Plan",
    translationLimit: null,
    creditCost: 1,
    videoLimit: null,
    videoWindow: "monthly" as const,
    mentorDailyLimit: null,
    dailyCreditCeiling: null,
    priceUsdCents: 900,
    isActive: true,
    isDefault: false,
  },
];

const STATE: OnboardingState = {
  userId: 1,
  persistedStep: 3,
  step: 3,
  nativeLang: "ru",
  interfaceLang: "ru",
  learningLangs: ["de"],
  levels: { de: "B1" },
};

function createCtx(options: { messageId?: number; cardMsgId?: number } = {}): BotContext {
  const services = createServicesStub();
  vi.mocked(services.settings.getPlanLimits).mockResolvedValue(PLAN_CATALOG);
  return {
    chat: { id: 555 },
    from: { id: 555 },
    user: { id: 1, audienceGroup: "product", subscriptionPlan: "pro" },
    ...(options.messageId === undefined ? {} : { message: { message_id: options.messageId } }),
    session: {
      activeMode: "translate",
      translationMap: {},
      ...(options.cardMsgId === undefined ? {} : { pendingCardMsgId: options.cardMsgId }),
    },
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 950 }),
      sendAnimation: vi.fn().mockResolvedValue({ message_id: 951 }),
    },
    services: services as unknown as ServiceContainer,
  } as unknown as BotContext;
}

/** A live trial row, as `findActiveByUser` returns it. */
const TRIAL = { plan: "pro", provider: "trial", status: "active" } as never;

const lang: SupportedLang = "ru";

describe("closing screen — the card it describes", () => {
  /**
   * Navigation, not features: `← Back` leaves the action list, and the
   * source-language override is a header plus one flag per candidate. Naming them
   * would pad the screen without teaching anything the user needs on day one.
   */
  const UNDESCRIBED = ["tr:less:", "tr:srclang:", `${NOOP_CALLBACK}`, "notif:fb:"];

  it("has a hint for every card button that is not navigation", () => {
    // The guard on the one way this screen can still drift: a button added to the
    // card with no entry in the hint table would silently vanish from the hand-off.
    const maximal = { interfaceLang: lang, showMentorButton: true, showEtymologyButton: true };
    const every = [
      ...buildTranslationKeyboard({ ...maximal, pronounceLangs: ["de"] }).inline_keyboard.flat(),
      ...buildTranslationKeyboard({ ...maximal, expanded: true, sourceOverrideLangs: ["de"] }).inline_keyboard.flat(),
    ];

    const undescribed = every
      .map((button) => ("callback_data" in button ? button.callback_data : ""))
      .filter((data) => data !== "")
      .filter((data) => !CARD_BUTTON_HINTS.some(([prefix]) => data.startsWith(prefix)))
      .filter((data) => !UNDESCRIBED.some((prefix) => data.startsWith(prefix)));

    expect(undescribed).toEqual([]);
  });

  it("nests the actions that only appear once Explore is tapped", async () => {
    const text = await buildClosingText(createCtx(), STATE, null);

    // The flat list this screen used to teach ("🔄 Другое значение" beside "💾
    // Сохранить") stopped being true the day the actions moved behind Explore.
    const lines = text.split("\n");
    const explore = lines.findIndex((line) => line.startsWith(t("cardExploreWord", lang)));
    const other = lines.findIndex((line) => line.trim().startsWith(t("otherMeaning", lang)));
    expect(explore).toBeGreaterThan(-1);
    expect(other).toBeGreaterThan(explore);
    expect(lines[other]).toMatch(/^ +/);
    expect(lines[other]).toContain(t("cardHintOtherMeaning", lang));
  });

  it("lists the hot buttons the keyboard actually carries", async () => {
    const text = await buildClosingText(createCtx(), STATE, null);

    // Both sides come from `MAIN_MENU_ROWS`, so a retired button cannot survive
    // here as prose after it has left the keyboard.
    for (const entry of mainMenuEntries(lang)) {
      expect(text).toContain(`${entry.label} — ${entry.hint}`);
    }
  });
});

describe("closing screen — the trial announcement", () => {
  it("names the plan the ledger granted, in the catalog's own words", async () => {
    const text = await buildClosingText(createCtx(), STATE, TRIAL);

    // An admin renaming the tier in the panel reaches this screen with no deploy.
    expect(text).toContain("Pro Plan");
    expect(text).toContain(`• ${t("planLineTranslationsUnlimited", lang)}`);
    expect(text).toContain(String(TRIAL_EXTENSION_WORDS));
  });

  it("wears the glyph of the tier it is selling, not Plus's", async () => {
    const text = await buildClosingText(createCtx(), STATE, TRIAL);

    // ⭐ sells Plus. The frozen copy wore it while announcing Pro, which put the
    // wrong badge on the one promise the whole first week rests on.
    expect(text).toContain("💎");
    expect(text).not.toContain("⭐");
  });

  it("falls back to the bare plan name when the catalog has no such plan", async () => {
    const ctx = createCtx();
    vi.mocked(ctx.services.settings.getPlanLimits).mockResolvedValue([]);

    const text = await buildClosingText(ctx, STATE, TRIAL);

    // A list invented for a plan nobody can describe would promise features the
    // account may not hold; the length and the extension rule still land.
    expect(text).toContain("pro");
    expect(text).not.toContain(t("planLineTranslationsUnlimited", lang));
    expect(text).toContain(String(TRIAL_EXTENSION_WORDS));
  });

  it("says nothing about a trial when none is live", async () => {
    const text = await buildClosingText(createCtx(), STATE, null);

    expect(text).not.toContain(String(TRIAL_EXTENSION_WORDS));
  });
});

describe("closing screen — delivery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns at once and sends only when the delay has run out", async () => {
    vi.useFakeTimers();
    try {
      const ctx = createCtx({ messageId: 42 });

      scheduleClosingScreen(ctx, "instructions", lang);

      // Updates are sequentialized per chat: waiting here would leave the bot deaf
      // to this user for the whole delay.
      expect(ctx.api.sendMessage).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(CLOSING_SCREEN_DELAY_MS - 1);
      expect(ctx.api.sendMessage).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(ctx.api.sendMessage).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("replies to the message that was translated", async () => {
    const ctx = createCtx({ messageId: 42, cardMsgId: 77 });

    scheduleClosingScreen(ctx, "instructions", lang);
    await flushScheduledClosings();

    expect(vi.mocked(ctx.api.sendMessage).mock.calls[0]?.[2]).toMatchObject({
      reply_parameters: { message_id: 42, allow_sending_without_reply: true },
    });
  });

  it("replies to the card when the word was tapped rather than typed", async () => {
    const ctx = createCtx({ cardMsgId: 77 });

    scheduleClosingScreen(ctx, "instructions", lang);
    await flushScheduledClosings();

    // A curated hook word arrives as a callback query, so there is no user message
    // to hang the instructions on — the card they explain is the next best anchor.
    expect(vi.mocked(ctx.api.sendMessage).mock.calls[0]?.[2]).toMatchObject({
      reply_parameters: { message_id: 77 },
    });
  });

  it("claims the keyboard version inside the update, not from the timer", async () => {
    const ctx = createCtx({ cardMsgId: 77 });

    scheduleClosingScreen(ctx, "instructions", lang);

    // The session is written back when this update ends, so a flag set from the
    // timer would be dropped and every user would get the menu hint a second time.
    expect(ctx.session.mainKeyboardVersion).toBeDefined();
  });

  it("swallows a failed send rather than crashing the timer", async () => {
    const ctx = createCtx({ cardMsgId: 77 });
    vi.mocked(ctx.api.sendMessage).mockRejectedValue(new Error("bot was blocked by the user"));

    scheduleClosingScreen(ctx, "instructions", lang);

    // Nothing is awaiting this; an unhandled rejection here takes the process down.
    await expect(flushScheduledClosings()).resolves.toBeUndefined();
  });
});
