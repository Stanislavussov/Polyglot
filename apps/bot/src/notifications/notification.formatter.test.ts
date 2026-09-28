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
import { type SupportedLang, t } from "@polyglot/core";
import {
  buildNotificationKeyboard,
  buildNotificationRestoreKeyboard,
  formatCardNotification,
  formatNotificationMessage,
  SELF_CHECK_KEYS,
} from "./notification.formatter.js";

const INTERFACE_LANGS: readonly SupportedLang[] = ["en", "ru", "cs", "de", "fr", "es", "it", "pt", "uk", "pl", "kk"];

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

  it("renders emoji, the source label and the word — the headword the Reveal card shows", () => {
    expect(formatNotificationMessage(srsPayload, "en")).toContain("🏠 🇬🇧 EN: <b>house</b>");
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

  // ── Rotating question ──────────────────────────────────────────
  // The same sentence under every daily word stops being read; the question varies
  // while its place in the message does not.

  it("asks a different question for each variant and wraps past the last one", () => {
    const questionAt = (selfCheckVariant: number): string | undefined =>
      contentLines(formatNotificationMessage(srsPayload, "en", { selfCheckVariant }))[1];

    expect(questionAt(3)).toBe(`<i>${t("notifSelfCheck4", "en")}</i>`);
    expect(questionAt(SELF_CHECK_KEYS.length)).toBe(questionAt(0));
    expect(new Set(SELF_CHECK_KEYS.map((_, index) => questionAt(index))).size).toBe(SELF_CHECK_KEYS.length);
  });

  it("has every question written in every interface language", () => {
    for (const lang of INTERFACE_LANGS) {
      const questions = SELF_CHECK_KEYS.map((key) => t(key, lang));
      expect(new Set(questions).size).toBe(SELF_CHECK_KEYS.length);
      // A key missing from a locale falls back to English, which only English may equal.
      if (lang !== "en") {
        expect(questions.filter((question, index) => question === t(SELF_CHECK_KEYS[index]!, "en"))).toEqual([]);
      }
    }
  });
});

function callbackData(kb: ReturnType<typeof buildNotificationKeyboard>): Array<string | undefined> {
  return kb.inline_keyboard.flat().map((b) => ("callback_data" in b ? b.callback_data : undefined));
}

describe("buildNotificationKeyboard", () => {
  it("gives a dictionary word the card's buttons — Reveal and Remove — then the notification settings", () => {
    expect(callbackData(buildNotificationKeyboard("en", 42))).toEqual([
      "notif:deck:42",
      "notif:learned:42",
      "notif:settings",
    ]);
  });

  it("carries no grades before the card is revealed — ratings belong to the revealed card", () => {
    expect(callbackData(buildNotificationKeyboard("en", 42)).some((data) => data?.startsWith("notif:fb:"))).toBe(false);
  });

  it("leaves a removal confirmation with the way back and nothing else", () => {
    expect(callbackData(buildNotificationRestoreKeyboard("en", 42))).toEqual(["notif:restore:42"]);
  });

  it("offers a word with no saved entry the one button it can honour", () => {
    // Nothing to rate and nothing to remove — but the reader still gets the
    // answer, by translating the word rather than opening an entry that is not there.
    expect(callbackData(buildNotificationKeyboard("en"))).toEqual(["notif:tr", "notif:settings"]);
  });
});

describe("card notification", () => {
  const front = "<b>pes</b> 🇨🇿";

  it("shows one card as just its front and the recall question", () => {
    const text = formatCardNotification(front, 1, "en", { selfCheckVariant: 0 });

    expect(text).toBe(`${front}\n\n<i>${t("notifSelfCheck", "en")}</i>`);
  });

  it("says how many cards the notification brings before the first card", () => {
    const text = formatCardNotification(front, 5, "en");

    expect(text.split("\n")[0]).toBe("🃏 Cards to review: 5");
    expect(text).toContain(front);
  });

  it("asks the recall question under the card, never above it", () => {
    const text = formatCardNotification(front, 3, "en", { selfCheckVariant: 0 });

    expect(text.indexOf(front)).toBeLessThan(text.indexOf("<i>"));
  });

  it("puts the weekly line last, and leaves no trace of it when there is none", () => {
    expect(formatCardNotification(front, 3, "en", { footer: "📈 week" }).endsWith("\n\n📈 week")).toBe(true);
    expect(formatCardNotification(front, 3, "en")).not.toMatch(/\n$/);
  });
});
