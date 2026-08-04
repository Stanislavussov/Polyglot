/**
 * Tests for the persistent main-menu reply keyboard: what it renders and how taps
 * on it are matched back to an action.
 */
import { getSupportedLangs, t } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { buildMainKeyboard, mainMenuLabels, matchMainMenuAction } from "./main-menu.js";

describe("main menu keyboard", () => {
  it("renders the three entry points on a single row, localized and icon-prefixed", () => {
    const rows = buildMainKeyboard("ru")
      .build()
      .map((row) => row.map((button) => (typeof button === "string" ? button : button.text)));

    // One row, no empty trailing row: a persistent keyboard costs chat space per row.
    expect(rows).toEqual([["📖 Словарь", "🎴 Карточки", "🎬 Видео"]]);
  });

  it("stays open instead of collapsing behind the keyboard icon", () => {
    const kb = buildMainKeyboard("en");

    expect(kb.is_persistent).toBe(true);
    expect(kb.resize_keyboard).toBe(true);
  });

  it("matches a tap in every supported language back to its action", () => {
    for (const lang of getSupportedLangs()) {
      expect(matchMainMenuAction(`📖 ${t("menuBtnDictionary", lang)}`)).toBe("dictionary");
      expect(matchMainMenuAction(`🎴 ${t("menuBtnFlashcards", lang)}`)).toBe("flashcard");
      expect(matchMainMenuAction(`🎬 ${t("menuBtnVideos", lang)}`)).toBe("videos");
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
