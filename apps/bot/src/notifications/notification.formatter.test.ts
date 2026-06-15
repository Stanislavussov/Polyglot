/**
 * Tests for notification message formatter.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return {
    ...actual,
    getLangFlag: (code: string) => {
      const flags: Record<string, string> = { en: "🇬🇧", cs: "🇨🇿", ru: "🇷🇺" };
      return flags[code];
    },
  };
});

import type { NotificationPayload } from "@polyglot/adapter-notifications";
import { buildNotificationKeyboard, formatNotificationMessage } from "./notification.formatter.js";

describe("formatNotificationMessage", () => {
  const srsPayload: NotificationPayload = {
    hour: 8,
    word: {
      original: "house",
      emoji: "🏠",
      nativeMeaning: "A building where people live.",
      translations: { cs: "dům", ru: "дом" },
      source: "srs",
    },
    message: "pre-built message",
  };

  const suggestedPayload: NotificationPayload = {
    hour: 20,
    word: {
      original: "garden",
      emoji: "🌿",
      translations: { en: "garden" },
      source: "suggested",
    },
    message: "pre-built message",
  };

  it("renders emoji and original word in bold", () => {
    const msg = formatNotificationMessage(srsPayload, "en");
    expect(msg).toContain("🏠 <b>house</b>");
  });

  it("shows SRS source label for dictionary words", () => {
    const msg = formatNotificationMessage(srsPayload, "en");
    // The translated value contains "dictionary" or "From your dict"
    expect(msg).toMatch(/dictionary|dict/i);
  });

  it("shows AI source label for suggested words", () => {
    const msg = formatNotificationMessage(suggestedPayload, "en");
    // The translated value contains "AI" or "suggestion"
    expect(msg).toMatch(/AI|suggestion/i);
  });

  it("renders translations with flag emojis", () => {
    const msg = formatNotificationMessage(srsPayload, "en");
    expect(msg).toContain("🇨🇿 CS: dům");
    expect(msg).toContain("🇷🇺 RU: дом");
  });

  it("renders persisted native meaning when available", () => {
    const msg = formatNotificationMessage(srsPayload, "en");
    expect(msg).toContain("A building where people live.");
  });

  it("renders synonyms under translation when translationDetails present", () => {
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
      message: "",
    };
    const msg = formatNotificationMessage(payload, "en");
    expect(msg).toContain("≈ начинающий, зарождающийся");
    expect(msg).toContain("≈ nastávající");
  });

  it("omits synonym line when no translationDetails for a language", () => {
    const payload: NotificationPayload = {
      hour: 8,
      word: {
        original: "test",
        emoji: "📝",
        translations: { en: "test", ru: "тест" },
        translationDetails: { ru: { synonyms: ["проверка"] } },
      },
      message: "",
    };
    const msg = formatNotificationMessage(payload, "en");
    expect(msg).toContain("≈ проверка");
    expect(msg).not.toMatch(/≈.*test/);
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
      message: "",
    };
    const msg = formatNotificationMessage(payload, "en");
    expect(msg).toContain("a &lt;b&gt; &amp; c");
  });

  it("uses fallback flag for unknown languages", () => {
    const payload: NotificationPayload = {
      hour: 8,
      word: {
        original: "test",
        emoji: "📝",
        translations: { xx: "test" },
      },
      message: "",
    };
    const msg = formatNotificationMessage(payload, "en");
    expect(msg).toContain("🔤 XX: test");
  });

  it("escapes HTML entities in original word", () => {
    const payload: NotificationPayload = {
      hour: 8,
      word: {
        original: "a <b> & c",
        emoji: "📝",
        translations: { en: "test" },
      },
      message: "",
    };
    const msg = formatNotificationMessage(payload, "en");
    expect(msg).toContain("a &lt;b&gt; &amp; c");
    expect(msg).not.toContain("<b> &");
  });

  it("includes translations header from i18n", () => {
    const msg = formatNotificationMessage(srsPayload, "en");
    // The translations header should be present (check for "Translations" or similar)
    expect(msg).toMatch(/translation/i);
  });
});

describe("buildNotificationKeyboard", () => {
  it("creates keyboard with Open dictionary and Skip buttons", () => {
    const kb = buildNotificationKeyboard("en");
    const buttons = kb.inline_keyboard.flat();
    const cbData = buttons.map((b) => ("callback_data" in b ? b.callback_data : undefined));
    expect(cbData).toContain("notif:open");
    expect(cbData).toContain("notif:skip");
  });

  it("has exactly 2 buttons", () => {
    const kb = buildNotificationKeyboard("en");
    const buttons = kb.inline_keyboard.flat();
    expect(buttons).toHaveLength(2);
  });
});
