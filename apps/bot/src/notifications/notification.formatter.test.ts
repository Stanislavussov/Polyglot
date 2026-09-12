/**
 * Tests for notification message formatter.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return {
    ...actual,
    getLangFlag: (code: string) => {
      const flags: Record<string, string> = { en: "🇬🇧", cs: "🇨🇿", ru: "🇷🇺", de: "🇩🇪" };
      return flags[code];
    },
  };
});

import type { NotificationPayload } from "@polyglot/adapter-notifications";
import { t } from "@polyglot/core";
import { buildNotificationKeyboard, formatNotificationMessage } from "./notification.formatter.js";

/** Content lines only; blank separators are layout, not content. */
function contentLines(msg: string): string[] {
  return msg.split("\n").filter((l) => l.trim() !== "");
}

describe("formatNotificationMessage", () => {
  const srsPayload: NotificationPayload = {
    hour: 8,
    word: {
      original: "house",
      emoji: "🏠",
      sourceLang: "en",
      nativeMeaning: "A building where people live.",
      translations: { cs: "dům", ru: "дом" },
      source: "srs",
      entryId: 42,
    },
  };

  // The notification is the moment of recall: the word, the question, and
  // nothing else. Everything it used to inline is behind Reveal, which opens the
  // card the word was translated on.

  it("renders emoji, the source flag and the word — the headword the Reveal card shows", () => {
    expect(formatNotificationMessage(srsPayload, "en")).toContain("🏠 🇬🇧 <b>house</b>");
  });

  it("prefers the stored citation form, as the card behind Reveal does", () => {
    const payload: NotificationPayload = { ...srsPayload, word: { ...srsPayload.word, headword: "a house" } };
    expect(formatNotificationMessage(payload, "en")).toContain("<b>a house</b>");
  });

  it("keeps the flag slot when the word's language cannot be resolved", () => {
    const { sourceLang: _dropped, ...word } = srsPayload.word;
    expect(formatNotificationMessage({ ...srsPayload, word }, "en")).toContain("🏠 🔤 <b>house</b>");
  });

  it("hands over nothing that answers the word", () => {
    const msg = formatNotificationMessage(srsPayload, "en");

    expect(msg).not.toContain("дом");
    expect(msg).not.toContain("dům");
    expect(msg).not.toContain("A building where people live.");
    // Not even where the word came from: a label is one more line to read past.
    expect(msg).not.toMatch(/dictionary|dict/i);
  });

  it("asks the reader to check themselves, one line below the word", () => {
    const lines = contentLines(formatNotificationMessage(srsPayload, "en"));

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("<b>house</b>");
    expect(lines[1]).toBe(`<i>${t("notifSelfCheck", "en")}</i>`);
  });

  it("keeps the whole message to the word, the prompt and the blank between them", () => {
    expect(formatNotificationMessage(srsPayload, "en").split("\n")).toHaveLength(3);
  });

  it("says the same for a word the reader never saved", () => {
    // A curated pick has no entry to open, but the message it arrives in is the
    // same prompt: only the button behind it differs.
    const preset: NotificationPayload = {
      hour: 8,
      word: { original: "Kündigung", emoji: "📄", sourceLang: "de", translations: { ru: "увольнение" } },
    };
    const lines = contentLines(formatNotificationMessage(preset, "ru"));

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("<b>Kündigung</b>");
    expect(lines[1]).toBe(`<i>${t("notifSelfCheck", "ru")}</i>`);
    expect(lines.join("\n")).not.toContain("увольнение");
  });

  it("escapes HTML entities in the word", () => {
    const payload: NotificationPayload = {
      hour: 8,
      word: { original: "a <b> & c", emoji: "📝", translations: { en: "test" }, entryId: 7 },
    };
    const msg = formatNotificationMessage(payload, "en");

    expect(msg).toContain("a &lt;b&gt; &amp; c");
    expect(msg).not.toContain("<b> &");
  });

  // ── Footer (Task 81, S4) ───────────────────────────────────────
  // The motivation layer is off by default and gated behind a kill switch, so
  // "no footer" is the state almost every card ships in: it must be identical to
  // the card as it was before the slot existed, byte for byte.

  it("renders the card unchanged when no footer is passed", () => {
    expect(formatNotificationMessage(srsPayload, "en", {})).toBe(formatNotificationMessage(srsPayload, "en"));
  });

  it("puts the footer last, separated from the prompt", () => {
    const footer = "This week — in long-term memory: 3, reviews: 14.";
    const msg = formatNotificationMessage(srsPayload, "en", { footer });

    expect(msg.endsWith(`\n\n${footer}`)).toBe(true);
    // Everything the card said without a footer is still there, in order.
    expect(msg.startsWith(formatNotificationMessage(srsPayload, "en"))).toBe(true);
  });
});

function callbackData(kb: ReturnType<typeof buildNotificationKeyboard>): Array<string | undefined> {
  return kb.inline_keyboard.flat().map((b) => ("callback_data" in b ? b.callback_data : undefined));
}

describe("buildNotificationKeyboard", () => {
  it("shows Reveal, the three feedback grades, and Remove", () => {
    expect(callbackData(buildNotificationKeyboard("en", 42))).toEqual([
      "notif:reveal:42",
      "notif:fb:hard:42",
      "notif:fb:normal:42",
      "notif:fb:easy:42",
      "notif:learned:42",
    ]);
  });

  it("keeps the grade row together and Remove on its own row", () => {
    expect(buildNotificationKeyboard("en", 42).inline_keyboard.map((row) => row.length)).toEqual([1, 3, 1]);
  });

  it("marks the selected grade with a check while keeping all buttons tappable", () => {
    const buttons = buildNotificationKeyboard("en", 42, "hard").inline_keyboard.flat();
    const hard = buttons.find((b) => "callback_data" in b && b.callback_data === "notif:fb:hard:42");
    const normal = buttons.find((b) => "callback_data" in b && b.callback_data === "notif:fb:normal:42");

    expect(hard?.text.startsWith("✓ ")).toBe(true);
    expect(normal?.text.startsWith("✓ ")).toBe(false);
  });

  it("offers a word with no saved entry the one button it can honour", () => {
    // Nothing to grade and nothing to remove — but the reader still gets the
    // answer, by translating the word rather than opening an entry that is not there.
    expect(callbackData(buildNotificationKeyboard("en"))).toEqual(["notif:tr"]);
  });
});
