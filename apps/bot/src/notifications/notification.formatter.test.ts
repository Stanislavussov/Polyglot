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
import { createLanguageOrderContext, type LanguageOrderContext } from "@polyglot/core";
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

  it("renders emoji and original word in bold", () => {
    const msg = formatNotificationMessage(srsPayload, "en", ruNative);
    expect(msg).toContain("🏠 <b>house</b>");
  });

  it("shows SRS source label for dictionary words", () => {
    const msg = formatNotificationMessage(srsPayload, "en", ruNative);
    expect(msg).toMatch(/dictionary|dict/i);
  });

  it("shows AI source label for suggested words", () => {
    const msg = formatNotificationMessage(suggestedPayload, "en", noPreference);
    expect(msg).toMatch(/AI|suggestion/i);
  });

  it("renders persisted native meaning when available", () => {
    const msg = formatNotificationMessage(srsPayload, "en", ruNative);
    expect(msg).toContain("A building where people live.");
  });

  // ── Section order ──────────────────────────────────────────────
  // The reported defect: the reader's own language landed on line 6, below the
  // stored meaning and two lines of chrome, so the card read as "my language
  // last". These assert the sequence, not mere presence.

  it("puts the native answer directly after the headword, above the meaning", () => {
    const lines = contentLines(formatNotificationMessage(srsPayload, "en", ruNative));
    const headword = lines.findIndex((l) => l.includes("house"));
    const answer = lines.findIndex((l) => l.includes("дом"));
    const meaning = lines.findIndex((l) => l.includes("A building"));

    expect(answer).toBe(headword + 1);
    expect(answer).toBeLessThan(meaning);
  });

  it("orders the whole card headword → answer → meaning → other languages", () => {
    const lines = contentLines(formatNotificationMessage(srsPayload, "en", ruNative));

    expect(lines.findIndex((l) => l.includes("house"))).toBeLessThan(lines.findIndex((l) => l.includes("дом")));
    expect(lines.findIndex((l) => l.includes("дом"))).toBeLessThan(lines.findIndex((l) => l.includes("A building")));
    expect(lines.findIndex((l) => l.includes("A building"))).toBeLessThan(lines.findIndex((l) => l.includes("dům")));
  });

  it("keeps the provenance label above the headword so it does not compete with the answer", () => {
    const lines = contentLines(formatNotificationMessage(srsPayload, "en", ruNative));
    expect(lines.findIndex((l) => /dictionary/i.test(l))).toBeLessThan(lines.findIndex((l) => l.includes("house")));
  });

  // Migrated from scheduler.test.ts, where it guarded the scheduler's re-keying.
  // That re-keying is gone: the order is now derived here, at render time, so
  // this is where the regression must be caught.
  it("orders by the user's languages even when the record arrives alphabetized", () => {
    const payload: NotificationPayload = {
      hour: 8,
      // As a jsonb round-trip returns it — alphabetical, native last.
      word: { original: "Haus", emoji: "🏠", translations: { cs: "dům", de: "Haus", ru: "дом" }, source: "srs" },
    };
    const lines = contentLines(formatNotificationMessage(payload, "en", ruNative));

    // ru (native) first, then cs, then de — the user's own order, not the record's.
    expect(lines.findIndex((l) => l.includes("дом"))).toBeLessThan(lines.findIndex((l) => l.includes("dům")));
    expect(lines.findIndex((l) => l.includes("dům"))).toBeLessThan(lines.findIndex((l) => l.includes("🇩🇪")));
  });

  it("bolds the answer and leaves secondary languages plain", () => {
    const msg = formatNotificationMessage(srsPayload, "en", ruNative);
    expect(msg).toContain("🇷🇺 <b>дом</b>");
    expect(msg).toContain("🇨🇿 dům");
    expect(msg).not.toContain("<b>dům</b>");
  });

  it("renders synonyms inline on the answer", () => {
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
        source: "srs",
      },
    };
    const msg = formatNotificationMessage(payload, "en", ruNative);

    expect(msg).toContain("🇷🇺 <b>незрелый</b> (начинающий, зарождающийся)");
    // Secondary languages stay to one line — the detail is a "Reveal" tap away.
    expect(msg).toContain("🇨🇿 počínající");
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
      word: { original: "a <b> & c", emoji: "📝", translations: { en: "test" } },
    };
    const msg = formatNotificationMessage(payload, "en", noPreference);
    expect(msg).toContain("a &lt;b&gt; &amp; c");
    expect(msg).not.toContain("<b> &");
  });

  it("escapes HTML entities in synonyms", () => {
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

  it("renders a card with no translations without throwing", () => {
    const payload: NotificationPayload = {
      hour: 8,
      word: { original: "orphan", emoji: "📝", translations: {} },
    };
    const msg = formatNotificationMessage(payload, "en", ruNative);
    expect(msg).toContain("orphan");
  });
});

describe("buildNotificationKeyboard", () => {
  it("creates keyboard with Reveal and Learned buttons when entryId provided", () => {
    const kb = buildNotificationKeyboard("en", 42);
    const buttons = kb.inline_keyboard.flat();
    const cbData = buttons.map((b) => ("callback_data" in b ? b.callback_data : undefined));
    expect(cbData).toContain("notif:reveal:42");
    expect(cbData).toContain("notif:learned:42");
  });

  it("has exactly 2 buttons when entryId provided", () => {
    const kb = buildNotificationKeyboard("en", 42);
    const buttons = kb.inline_keyboard.flat();
    expect(buttons).toHaveLength(2);
  });

  it("returns empty keyboard when no entryId", () => {
    const kb = buildNotificationKeyboard("en");
    const buttons = kb.inline_keyboard.flat();
    expect(buttons).toHaveLength(0);
  });
});

describe("buildNotificationRevealedKeyboard", () => {
  it("creates keyboard with only Learned button", () => {
    const kb = buildNotificationRevealedKeyboard("en", 42);
    const buttons = kb.inline_keyboard.flat();
    expect(buttons).toHaveLength(1);
    const cbData = buttons.map((b) => ("callback_data" in b ? b.callback_data : undefined));
    expect(cbData).toContain("notif:learned:42");
  });
});
