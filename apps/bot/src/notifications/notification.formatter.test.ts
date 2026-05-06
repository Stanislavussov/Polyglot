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
    expect(msg).toContain("🇨🇿 dům");
    expect(msg).toContain("🇷🇺 дом");
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
    expect(msg).toContain("🔤 test");
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
    const cbData = buttons.map((b: any) => b.callback_data);
    expect(cbData).toContain("notif:open");
    expect(cbData).toContain("notif:skip");
  });

  it("has exactly 2 buttons", () => {
    const kb = buildNotificationKeyboard("en");
    const buttons = kb.inline_keyboard.flat();
    expect(buttons).toHaveLength(2);
  });
});
