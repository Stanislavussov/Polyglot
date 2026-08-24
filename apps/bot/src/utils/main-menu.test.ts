/**
 * Tests for the persistent main-menu reply keyboard: what it renders and how taps
 * on it are matched back to an action.
 */
import { getSupportedLangs, t } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { buildMainKeyboard, mainMenuLabels, matchMainMenuAction } from "./main-menu.js";

describe("main menu keyboard", () => {
  it("pairs the picker with the mentor on the top row, everyday entry points below", () => {
    const rows = buildMainKeyboard("ru")
      .build()
      .map((row) => row.map((button) => (typeof button === "string" ? button : button.text)));

    // Two rows, no empty trailing row: every row costs chat space while the menu is open.
    expect(rows).toEqual([
      ["✨ Подобрать слова", "🧑‍🏫 Ментор"],
      ["📖 Словарь", "🎴 Карточки", "🎬 Видео"],
    ]);
  });

  it("folds away after use instead of pinning itself to the bottom of the chat", () => {
    const kb = buildMainKeyboard("en");

    // Not persistent: a pinned keyboard costs the user screen space forever. It
    // lives behind the keyboard icon next to the input field instead.
    expect(kb.is_persistent).toBeUndefined();
    expect(kb.one_time_keyboard).toBe(true);
    expect(kb.resize_keyboard).toBe(true);
  });

  it("matches a tap in every supported language back to its action", () => {
    for (const lang of getSupportedLangs()) {
      expect(matchMainMenuAction(`✨ ${t("menuBtnPickWords", lang)}`)).toBe("pick");
      expect(matchMainMenuAction(`📖 ${t("menuBtnDictionary", lang)}`)).toBe("dictionary");
      expect(matchMainMenuAction(`🎴 ${t("menuBtnFlashcards", lang)}`)).toBe("flashcard");
      expect(matchMainMenuAction(`🎬 ${t("menuBtnVideos", lang)}`)).toBe("videos");
      expect(matchMainMenuAction(`🧑‍🏫 ${t("menuBtnMentor", lang)}`)).toBe("mentor");
    }
  });

  it("still matches labels from a language the user has since switched away from", () => {
    // The keyboard Telegram shows is whatever was last sent, so a Russian label can
    // arrive while the interface is already English.
    expect(matchMainMenuAction("📖 Словарь")).toBe("dictionary");
    expect(matchMainMenuAction("📖 Dictionary")).toBe("dictionary");
  });

  it("does not match an ordinary word the user wants translated", () => {
    expect(matchMainMenuAction("Словарь")).toBeUndefined();
    expect(matchMainMenuAction("dictionary")).toBeUndefined();
    expect(matchMainMenuAction("📖")).toBeUndefined();
  });

  it("exposes every label so bot.hears intercepts taps before translate mode", () => {
    const labels = mainMenuLabels();

    expect(labels).toContain("🎬 Videos");
    expect(labels.every((label) => matchMainMenuAction(label) !== undefined)).toBe(true);
  });
});
