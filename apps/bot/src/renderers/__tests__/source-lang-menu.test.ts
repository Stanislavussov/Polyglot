/**
 * Tests for buildSourceLangKeyboard — post-translation source language selection menu.
 */
import { describe, expect, it } from "vitest";
import { buildSourceLangKeyboard, type LangOption } from "../translation.renderer.js";

const threeLangs: LangOption[] = [
  { code: "ru", name: "🇷🇺 Русский" },
  { code: "en", name: "🇬🇧 English" },
  { code: "cs", name: "🇨🇿 Čeština" },
];

const twoLangs: LangOption[] = [
  { code: "ru", name: "🇷🇺 Русский" },
  { code: "en", name: "🇬🇧 English" },
];

describe("buildSourceLangKeyboard", () => {
  it("renders a button for each configured language", () => {
    const kb = buildSourceLangKeyboard(threeLangs, null);
    expect(kb).not.toBeNull();

    // InlineKeyboard stores rows internally
    const rows = (kb as any).inline_keyboard;
    // All buttons in one row
    expect(rows[0]).toHaveLength(3);
  });

  it("marks currently selected language with ✓ prefix", () => {
    const kb = buildSourceLangKeyboard(threeLangs, "cs");
    const rows = (kb as any).inline_keyboard;
    const buttons = rows[0];

    const csBtn = buttons.find((b: any) => b.callback_data === "tr:srclang:cs");
    expect(csBtn.text).toBe("✓ 🇨🇿 Čeština");
  });

  it("does not mark any button when nothing is selected", () => {
    const kb = buildSourceLangKeyboard(threeLangs, null);
    const rows = (kb as any).inline_keyboard;
    const buttons = rows[0];

    for (const btn of buttons) {
      expect(btn.text).not.toContain("✓");
    }
  });

  it("unmarks previously selected when a different language is selected", () => {
    const kb = buildSourceLangKeyboard(threeLangs, "en");
    const rows = (kb as any).inline_keyboard;
    const buttons = rows[0];

    const enBtn = buttons.find((b: any) => b.callback_data === "tr:srclang:en");
    const ruBtn = buttons.find((b: any) => b.callback_data === "tr:srclang:ru");
    const csBtn = buttons.find((b: any) => b.callback_data === "tr:srclang:cs");

    expect(enBtn.text).toBe("✓ 🇬🇧 English");
    expect(ruBtn.text).toBe("🇷🇺 Русский");
    expect(csBtn.text).toBe("🇨🇿 Čeština");
  });

  it("returns null for only 2 languages (auto-detect sufficient)", () => {
    const kb = buildSourceLangKeyboard(twoLangs, null);
    expect(kb).toBeNull();
  });

  it("returns null for single language", () => {
    const kb = buildSourceLangKeyboard([{ code: "en", name: "🇬🇧 English" }], null);
    expect(kb).toBeNull();
  });

  it("uses correct callback data format (tr:srclang:{code})", () => {
    const kb = buildSourceLangKeyboard(threeLangs, null);
    const rows = (kb as any).inline_keyboard;
    const buttons = rows[0];

    expect(buttons[0].callback_data).toBe("tr:srclang:ru");
    expect(buttons[1].callback_data).toBe("tr:srclang:en");
    expect(buttons[2].callback_data).toBe("tr:srclang:cs");
  });

  it("renders 4 buttons for 4 languages", () => {
    const fourLangs: LangOption[] = [
      { code: "ru", name: "🇷🇺 Русский" },
      { code: "en", name: "🇬🇧 English" },
      { code: "cs", name: "🇨🇿 Čeština" },
      { code: "de", name: "🇩🇪 Deutsch" },
    ];
    const kb = buildSourceLangKeyboard(fourLangs, null);
    expect(kb).not.toBeNull();

    const rows = (kb as any).inline_keyboard;
    expect(rows[0]).toHaveLength(4);
  });
});
