import { initLanguageRegistry } from "@polyglot/core";
import { beforeAll, describe, expect, it } from "vitest";
import { isValidTelegramCallbackData } from "../../callbacks/contracts.js";
import { buildTranslationKeyboard } from "../translation.renderer.js";

// The bot lane resolves `@polyglot/core` to dist, whose registry the shared
// `test-setup.ts` (which seeds the src copy) never touches — so flags would be
// absent here and the buttons would silently assert their fallback shape instead
// of the label users actually see. Seed the registry the renderer really reads.
beforeAll(() => {
  initLanguageRegistry([
    { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪", isSupported: true },
    { code: "es", name: "Spanish", nativeName: "Español", flag: "🇪🇸", isSupported: true },
    { code: "cs", name: "Czech", nativeName: "Čeština", flag: "🇨🇿", isSupported: true },
    { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷", isSupported: true },
    { code: "it", name: "Italian", nativeName: "Italiano", flag: "🇮🇹", isSupported: true },
    { code: "pl", name: "Polish", nativeName: "Polski", flag: "🇵🇱", isSupported: true },
  ]);
});

const MAX_MSG_ID = 2_147_483_647;

/** Callback payloads of every button on the keyboard, flattened across rows. */
function callbackData(keyboard: ReturnType<typeof buildTranslationKeyboard>): string[] {
  return keyboard.inline_keyboard.flat().map((b) => ("callback_data" in b ? b.callback_data : ""));
}

/** Rows that contain at least one pronunciation button. */
function pronounceRows(keyboard: ReturnType<typeof buildTranslationKeyboard>): string[][] {
  return keyboard.inline_keyboard
    .map((row) => row.map((b) => ("callback_data" in b ? b.callback_data : "")))
    .filter((row) => row.some((d) => d.startsWith("tr:say:")));
}

/** Labels of the pronunciation buttons only. */
function pronounceLabels(keyboard: ReturnType<typeof buildTranslationKeyboard>): string[] {
  return keyboard.inline_keyboard
    .flat()
    .filter((b) => "callback_data" in b && b.callback_data.startsWith("tr:say:"))
    .map((b) => b.text);
}

const build = (pronounceLangs?: readonly string[], locked?: ReadonlySet<string>) =>
  buildTranslationKeyboard({ interfaceLang: "en", msgId: MAX_MSG_ID, pronounceLangs, locked });

describe("buildTranslationKeyboard — pronunciation row", () => {
  it("renders no pronunciation button when no language is eligible", () => {
    for (const langs of [undefined, []]) {
      expect(callbackData(build(langs)).filter((d) => d.startsWith("tr:say:"))).toEqual([]);
    }
  });

  it("gives a single eligible language one labelled button", () => {
    const rows = pronounceRows(build(["de"]));
    expect(rows).toEqual([[`tr:say:de:${MAX_MSG_ID}`]]);
  });

  it("gives several eligible languages one compact button each, in the given order", () => {
    const rows = pronounceRows(build(["es", "de", "cs"]));
    expect(rows).toEqual([[`tr:say:es:${MAX_MSG_ID}`, `tr:say:de:${MAX_MSG_ID}`, `tr:say:cs:${MAX_MSG_ID}`]]);
  });

  it("badges the speaker for a plan without audio, in both the single and the compact layout", () => {
    const locked = new Set(["pronunciation"]);
    expect(pronounceLabels(build(["de"], locked)).every((label) => label.endsWith("⭐"))).toBe(true);
    expect(pronounceLabels(build(["de", "es"], locked)).every((label) => label.endsWith("⭐"))).toBe(true);
    // The buttons stay tappable — the handler, not the keyboard, denies the play.
    expect(pronounceRows(build(["de"], locked))).toEqual([[`tr:say:de:${MAX_MSG_ID}`]]);
  });

  it("wraps past four languages instead of growing one unreadable row", () => {
    const rows = pronounceRows(build(["de", "es", "fr", "it", "pl"]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(4);
    expect(rows[1]).toEqual([`tr:say:pl:${MAX_MSG_ID}`]);
  });

  it("keeps Save as the last row so the card's primary action does not move", () => {
    const keyboard = build(["de", "es"]);
    const lastRow = keyboard.inline_keyboard.at(-1)!;
    expect(lastRow.map((b) => ("callback_data" in b ? b.callback_data : ""))).toEqual([`tr:save:${MAX_MSG_ID}`]);
  });

  it("stays inside Telegram's 64-byte callback limit for the longest realistic payload", () => {
    // zh-Hant is the longest language code in the set; pair it with the largest
    // message id Telegram can hand us.
    const keyboard = build(["zh-Hant"]);
    for (const data of callbackData(keyboard)) {
      expect(isValidTelegramCallbackData(data)).toBe(true);
    }
  });

  it("labels a compact button with the speaker and the flag, and nothing else", () => {
    const labels = pronounceLabels(build(["de", "es"]));
    expect(labels).toEqual(["🔊 🇩🇪", "🔊 🇪🇸"]);
  });

  it("carries no language code once a flag is available", () => {
    // The code was dropped deliberately: four buttons with "🔊 🇩🇪 DE" wrap badly on
    // a narrow screen, and the flag alone already identifies the language.
    for (const label of pronounceLabels(build(["de", "es", "cs", "fr"]))) {
      expect(label).not.toMatch(/[A-Z]{2}/);
    }
  });

  it("falls back to the language code when a flag is missing, so buttons stay distinct", () => {
    // Two unregistered languages must not both render as the same generic glyph —
    // that would leave the user guessing which button is which.
    const labels = pronounceLabels(build(["sv", "da"]));
    expect(labels).toEqual(["🔊 SV", "🔊 DA"]);
    expect(new Set(labels).size).toBe(2);
  });
});
