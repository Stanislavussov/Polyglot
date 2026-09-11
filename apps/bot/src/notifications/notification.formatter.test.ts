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
import { createLanguageOrderContext, type LanguageOrderContext, t } from "@polyglot/core";
import {
  buildNotificationKeyboard,
  buildNotificationRevealedKeyboard,
  formatNotificationMessage,
} from "./notification.formatter.js";

/** A `ru`-native user studying Czech, then German. */
const ruNative: LanguageOrderContext = createLanguageOrderContext({
  nativeLang: "ru",
  learningLangs: ["cs", "de"],
});

/** A user who has chosen nothing — ranks everything by code. */
const noPreference: LanguageOrderContext = createLanguageOrderContext({ learningLangs: [] });

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

  const suggestedPayload: NotificationPayload = {
    hour: 20,
    word: {
      original: "garden",
      emoji: "🌿",
      translations: { en: "garden" },
      source: "suggested",
    },
  };

  // ── A saved word: the prompt, and nothing that answers it ──────
  // The notification is the moment of recall. Everything it used to inline —
  // the native answer, the stored meaning, the other languages, the provenance
  // label — is one Reveal tap away, and reading it there is the point.

  it("renders emoji, the source flag and the word — the headword the Reveal card shows", () => {
    const msg = formatNotificationMessage(srsPayload, "en", ruNative);
    expect(msg).toContain("🏠 🇬🇧 <b>house</b>");
  });

  it("keeps the flag slot when the word's language cannot be resolved", () => {
    const { sourceLang: _dropped, ...word } = srsPayload.word;
    const msg = formatNotificationMessage({ ...srsPayload, word }, "en", ruNative);
    expect(msg).toContain("🏠 🔤 <b>house</b>");
  });

  it("hands over nothing that answers the word", () => {
    const msg = formatNotificationMessage(srsPayload, "en", ruNative);

    expect(msg).not.toContain("дом");
    expect(msg).not.toContain("dům");
    expect(msg).not.toContain("A building where people live.");
    expect(msg).not.toMatch(/dictionary|dict/i);
  });

  it("asks the reader to check themselves, one line below the word", () => {
    const lines = contentLines(formatNotificationMessage(srsPayload, "en", ruNative));

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("<b>house</b>");
    expect(lines[1]).toBe(`<i>${t("notifSelfCheck", "en")}</i>`);
  });

  it("keeps the whole message to the word, the prompt and the blank between them", () => {
    expect(formatNotificationMessage(srsPayload, "en", ruNative).split("\n")).toHaveLength(3);
  });

  // ── A word with no dictionary entry: no button to tap ──────────
  // Curated presets, AI suggestions and contextual sentences carry no entryId, so
  // they get no Reveal button. Their answer goes into a collapsed quote instead of
  // vanishing — which also keeps them clear of the 48-hour editMessageText limit.

  it("folds the answer of an unrevealable word into a collapsed quote", () => {
    const msg = formatNotificationMessage(suggestedPayload, "en", noPreference);

    expect(msg).toContain(`<i>${t("notifTapToReveal", "en")}</i>`);
    expect(msg).toContain("<blockquote expandable>🇬🇧 EN: <b>garden</b></blockquote>");
  });

  it("labels where an unrevealable word came from, so an unfamiliar headword explains itself", () => {
    const msg = formatNotificationMessage(suggestedPayload, "en", noPreference);
    const lines = contentLines(msg);

    expect(lines[0]).toMatch(/AI|suggestion/i);
    expect(lines.findIndex((l) => l.includes("garden"))).toBe(1);
  });

  it("orders the hidden answer by the user's languages, not the record's key order", () => {
    const payload: NotificationPayload = {
      hour: 8,
      // As a jsonb round-trip returns it — alphabetical, native last.
      word: { original: "Haus", emoji: "🏠", translations: { cs: "dům", de: "Haus", ru: "дом" }, source: "preset" },
    };
    const msg = formatNotificationMessage(payload, "en", ruNative);

    // ru (native) first, then cs, then de — the user's own order.
    expect(msg.indexOf("дом")).toBeLessThan(msg.indexOf("dům"));
    expect(msg.indexOf("dům")).toBeLessThan(msg.indexOf("🇩🇪"));
  });

  it("gives every hidden language the same bold answer line", () => {
    const payload: NotificationPayload = {
      hour: 8,
      word: { original: "house", emoji: "🏠", translations: { cs: "dům", ru: "дом" }, source: "preset" },
    };
    const msg = formatNotificationMessage(payload, "en", ruNative);

    // A secondary language is still a translation: inside the quote it gets the
    // same bold answer line as the first, so the card does not read as two kinds
    // of list — nor differ from the card behind Reveal.
    expect(msg).toContain("🇷🇺 RU: <b>дом</b>");
    expect(msg).toContain("🇨🇿 CS: <b>dům</b>");
  });

  it("renders synonyms inline on the hidden answer", () => {
    const payload: NotificationPayload = {
      hour: 8,
      word: {
        original: "inchoate",
        emoji: "🌱",
        translations: { ru: "незрелый", cs: "počínající" },
        translationDetails: {
          ru: { synonyms: ["начинающий", "зарождающийся"] },
          cs: { synonyms: ["nastávající"] },
        },
        source: "preset",
      },
    };
    const msg = formatNotificationMessage(payload, "en", ruNative);

    expect(msg).toContain("🇷🇺 RU: <b>незрелый</b> (начинающий, зарождающийся)");
    // Secondary languages stay to one line — the detail is a "Reveal" tap away.
    expect(msg).toContain("🇨🇿 CS: <b>počínající</b>");
    expect(msg).not.toContain("nastávající");
  });

  it("keeps the language code when no flag resolves, so the language stays identifiable", () => {
    const payload: NotificationPayload = {
      hour: 8,
      word: { original: "test", emoji: "📝", translations: { xx: "test" } },
    };
    const msg = formatNotificationMessage(payload, "en", noPreference);
    expect(msg).toContain("🔤 XX: <b>test</b>");
  });

  it("escapes HTML entities in original word", () => {
    const payload: NotificationPayload = {
      hour: 8,
      word: { original: "a <b> & c", emoji: "📝", translations: { en: "test" }, entryId: 7 },
    };
    const msg = formatNotificationMessage(payload, "en", noPreference);
    expect(msg).toContain("a &lt;b&gt; &amp; c");
    expect(msg).not.toContain("<b> &");
  });

  it("escapes HTML entities in the hidden synonyms", () => {
    const payload: NotificationPayload = {
      hour: 8,
      word: {
        original: "test",
        emoji: "📝",
        translations: { en: "test" },
        translationDetails: { en: { synonyms: ["a <b> & c"] } },
      },
    };
    const msg = formatNotificationMessage(payload, "en", noPreference);
    expect(msg).toContain("a &lt;b&gt; &amp; c");
  });

  it("offers no reveal prompt when there is neither an entry nor a translation to hide", () => {
    const payload: NotificationPayload = {
      hour: 8,
      word: { original: "orphan", emoji: "📝", translations: {} },
    };
    const msg = formatNotificationMessage(payload, "en", ruNative);

    expect(msg).toContain("orphan");
    expect(msg).not.toContain("blockquote");
    expect(msg).not.toContain(t("notifTapToReveal", "en"));
  });

  // ── Footer (Task 81, S4) ───────────────────────────────────────
  // The motivation layer is off by default and gated behind a kill switch, so
  // "no footer" is the state almost every card ships in: it must be identical to
  // the card as it was before the slot existed, byte for byte.

  it("renders the card unchanged when no footer is passed", () => {
    expect(formatNotificationMessage(srsPayload, "en", ruNative, {})).toBe(
      formatNotificationMessage(srsPayload, "en", ruNative),
    );
  });

  it("puts the footer last, separated from the prompt", () => {
    const footer = "This week — in long-term memory: 3, reviews: 14.";
    const msg = formatNotificationMessage(srsPayload, "en", ruNative, { footer });

    expect(msg.endsWith(`\n\n${footer}`)).toBe(true);
    // Everything the card said without a footer is still there, in order.
    expect(msg.startsWith(formatNotificationMessage(srsPayload, "en", ruNative))).toBe(true);
  });
});

function callbackData(kb: ReturnType<typeof buildNotificationKeyboard>): Array<string | undefined> {
  return kb.inline_keyboard.flat().map((b) => ("callback_data" in b ? b.callback_data : undefined));
}

describe("buildNotificationKeyboard", () => {
  it("shows Reveal, the three feedback grades, and Remove", () => {
    const kb = buildNotificationKeyboard("en", 42);
    expect(callbackData(kb)).toEqual([
      "notif:reveal:42",
      "notif:fb:hard:42",
      "notif:fb:normal:42",
      "notif:fb:easy:42",
      "notif:learned:42",
    ]);
  });

  it("keeps the grade row together and Remove on its own row", () => {
    const kb = buildNotificationKeyboard("en", 42);
    const rows = kb.inline_keyboard.map((row) => row.length);
    expect(rows).toEqual([1, 3, 1]);
  });

  it("marks the selected grade with a check while keeping all buttons tappable", () => {
    const kb = buildNotificationKeyboard("en", 42, "hard");
    const buttons = kb.inline_keyboard.flat();
    const hard = buttons.find((b) => "callback_data" in b && b.callback_data === "notif:fb:hard:42");
    const normal = buttons.find((b) => "callback_data" in b && b.callback_data === "notif:fb:normal:42");
    expect(hard?.text.startsWith("✓ ")).toBe(true);
    expect(normal?.text.startsWith("✓ ")).toBe(false);
  });

  it("returns empty keyboard when no entryId", () => {
    const kb = buildNotificationKeyboard("en");
    expect(kb.inline_keyboard.flat()).toHaveLength(0);
  });
});

describe("buildNotificationRevealedKeyboard", () => {
  it("shows the feedback grades and Remove, without Reveal", () => {
    const kb = buildNotificationRevealedKeyboard("en", 42);
    expect(callbackData(kb)).toEqual([
      "notif:fb:hard:42",
      "notif:fb:normal:42",
      "notif:fb:easy:42",
      "notif:learned:42",
    ]);
  });

  it("marks the selected grade", () => {
    const kb = buildNotificationRevealedKeyboard("en", 42, "easy");
    const easy = kb.inline_keyboard.flat().find((b) => "callback_data" in b && b.callback_data === "notif:fb:easy:42");
    expect(easy?.text.startsWith("✓ ")).toBe(true);
  });
});
