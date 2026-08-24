/**
 * Tests for the hot-button reply keyboard: what it renders and how taps on it are matched
 * back to an action — including taps on buttons a previous layout left on screen.
 */
import { getSupportedLangs, t } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { MAIN_KEYBOARD_VERSION } from "../middlewares/main-keyboard.js";
import { buildMainKeyboard, mainMenuLabels, matchMenuTap } from "./main-menu.js";

/** Widest label Telegram fits on one line at three buttons per row (~360dp chat). */
const LABEL_BUDGET = 11;

describe("hot-button keyboard", () => {
  it("carries the three everyday actions on one row", () => {
    const rows = buildMainKeyboard("ru")
      .build()
      .map((row) => row.map((button) => (typeof button === "string" ? button : button.text)));

    expect(rows).toEqual([["🎴 Карточки", "🧑‍🏫 Ментор", "📖 Словарь"]]);
  });

  it("folds away after use instead of pinning itself to the bottom of the chat", () => {
    const kb = buildMainKeyboard("en");

    // Not persistent: a pinned keyboard costs the user screen space forever. It
    // lives behind the keyboard icon next to the input field instead.
    expect(kb.is_persistent).toBeUndefined();
    expect(kb.one_time_keyboard).toBe(true);
    expect(kb.resize_keyboard).toBe(true);
  });

  it("keeps every hot-button label inside the one-line width budget", () => {
    const overBudget = getSupportedLangs().flatMap((lang) =>
      (["menuBtnFlashcards", "menuBtnMentor", "menuBtnDictionary"] as const)
        .map((key) => `${lang}/${key}: ${t(key, lang)}`)
        .filter((entry) => (entry.split(": ")[1] ?? "").length > LABEL_BUDGET),
    );

    expect(overBudget).toEqual([]);
  });

  it("matches a tap in every supported language back to its action", () => {
    for (const lang of getSupportedLangs()) {
      expect(matchMenuTap(`🎴 ${t("menuBtnFlashcards", lang)}`)).toEqual({ action: "flashcard", legacy: false });
      expect(matchMenuTap(`🧑‍🏫 ${t("menuBtnMentor", lang)}`)).toEqual({ action: "mentor", legacy: false });
      expect(matchMenuTap(`📖 ${t("menuBtnDictionary", lang)}`)).toEqual({ action: "dictionary", legacy: false });
    }
  });

  it("still runs the modes whose buttons moved into /menu", () => {
    // A reply keyboard lives in the client until the bot sends a new one. Until then
    // the retired buttons are still tappable, and an unmatched tap would fall through
    // to the mode router — which would translate the word "Подбор".
    expect(matchMenuTap("✨ Подбор")).toEqual({ action: "pick", legacy: true });
    expect(matchMenuTap("🎬 Бейнелер")).toEqual({ action: "videos", legacy: true });
  });

  it("matches both generations of the picker label, long and one-word", () => {
    // The long form shipped first; it was cut to one word when a fifth button joined the
    // row. Both are still on unrefreshed keyboards.
    expect(matchMenuTap("✨ Подобрать слова")).toEqual({ action: "pick", legacy: true });
    expect(matchMenuTap("✨ Подбор")).toEqual({ action: "pick", legacy: true });
    expect(matchMenuTap("✨ Trouver des mots")).toEqual({ action: "pick", legacy: true });
    expect(matchMenuTap("✨ Choisir")).toEqual({ action: "pick", legacy: true });
  });

  it("covers every label the retired keys currently render, so no locale is left unmatched", () => {
    for (const lang of getSupportedLangs()) {
      expect(matchMenuTap(`✨ ${t("menuBtnPickWords", lang)}`)?.action).toBe("pick");
      expect(matchMenuTap(`🎬 ${t("menuBtnVideos", lang)}`)?.action).toBe("videos");
    }
  });

  it("still matches labels from a language the user has since switched away from", () => {
    // The keyboard Telegram shows is whatever was last sent, so a Russian label can
    // arrive while the interface is already English.
    expect(matchMenuTap("📖 Словарь")?.action).toBe("dictionary");
    expect(matchMenuTap("📖 Dictionary")?.action).toBe("dictionary");
  });

  it("does not match an ordinary word the user wants translated", () => {
    expect(matchMenuTap("Словарь")).toBeUndefined();
    expect(matchMenuTap("dictionary")).toBeUndefined();
    expect(matchMenuTap("📖")).toBeUndefined();
  });

  it("exposes every live and retired label so bot.hears intercepts taps before translate mode", () => {
    const labels = mainMenuLabels();

    // Live and retired both, and one from each side: `bot.hears` matches on this list
    // alone, so a label missing here is a tap that reaches the mode router.
    expect(labels).toContain("🧑‍🏫 Mentor");
    expect(labels).toContain("🎬 Videos");
    expect(labels).toContain("✨ Подобрать слова");
  });

  it("pins the keyboard version, which is what re-delivers a changed layout", () => {
    // Every other test reads the constant, so a layout change shipped without bumping it
    // would leave every existing user on the old keyboard and fail nothing. Update this
    // number deliberately, in the same commit as the layout.
    expect(MAIN_KEYBOARD_VERSION).toBe(4);
  });
});
