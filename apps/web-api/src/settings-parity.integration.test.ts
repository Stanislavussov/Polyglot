/**
 * Spec — the bot's settings surfaces on the web, over the bot's own repositories:
 *
 * 1. Notification preferences (on/off, times, type, batch size, timezone, context) are
 *    written where the bot's scheduler reads them; out-of-range values are refused; turning
 *    notifications on with no schedule seeds the admin default, as the bot's toggle does.
 * 2. The card template: save, reset, preview; a translated card drops what it turns off.
 * 3. The plan screen lists the admin-owned catalog and links upgrades to the bot.
 * 4. Release notes: testers and admins only, as the bot's /changes.
 * 5. A report lands in the same table as the bot's /report-issue.
 */
import { reportedIssueRepository } from "@polyglot/adapter-db";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../bot/src/test-helpers/integration/arrange.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../bot/src/test-helpers/integration/translate-ai-mock.js";
import { createWebHarness } from "./test-helpers/web-harness.js";

async function arrange(options: { plan?: string } = {}) {
  const web = await createWebHarness({ ai: deterministicTranslateAi() });
  const telegramId = uniqueTelegramId();
  const userId = await arrangeOnboardedTranslator(telegramId, options);
  const { cookie } = await web.login(telegramId);
  return { web, cookie, userId };
}

const ALL_OFF = {
  synonyms: false,
  examples: false,
  alternatives: false,
  equivalentNote: false,
  connotationWarning: false,
};

describe("web notification settings", () => {
  it("writes the preferences the bot's scheduler reads", async () => {
    const { web, cookie, userId } = await arrange();

    const res = await web.call(cookie, "PATCH", "/api/settings/notifications", {
      enabled: true,
      times: ["21:30", "08:00", "08:00"],
      type: "contextual",
      batchSize: 5,
      timezone: "Europe/Prague",
      context: "I work in a hospital",
    });

    expect(res.status).toBe(200);
    const stored = await web.bot.services.userRepository.getSettings(userId);
    expect(stored).toMatchObject({
      notificationEnabled: true,
      notificationTimes: ["08:00", "21:30"],
      notificationType: "contextual",
      notificationBatchSize: 5,
      timezone: "Europe/Prague",
      notificationContext: "I work in a hospital",
    });
    expect((res.body as { notifications: { times: string[] } }).notifications.times).toEqual(["08:00", "21:30"]);
  });

  it("refuses what the bot's screen never offers", async () => {
    const { web, cookie } = await arrange();
    const refused = [
      { times: [] },
      { times: ["08:15"] },
      { times: Array.from({ length: 13 }, (_, i) => `${String(i).padStart(2, "0")}:00`) },
      { type: "daily" },
      { batchSize: 4 },
      { timezone: "Mars/Olympus" },
    ];
    for (const body of refused) {
      expect((await web.call(cookie, "PATCH", "/api/settings/notifications", body)).status).toBe(400);
    }
  });

  it("seeds the admin default time when notifications are turned on with no schedule", async () => {
    const { web, cookie, userId } = await arrange();
    await web.bot.services.notificationRepository.updatePrefs(userId, {
      notificationEnabled: false,
      notificationTimes: [],
    });
    const { defaultTime } = await web.bot.services.settings.getNotificationDefaults();

    await web.call(cookie, "PATCH", "/api/settings/notifications", { enabled: true });

    const stored = await web.bot.services.userRepository.getSettings(userId);
    expect(stored?.notificationEnabled).toBe(true);
    expect(stored?.notificationTimes).toEqual([defaultTime]);
  });
});

describe("web card template", () => {
  it("saves a custom template the bot reads, previews it and resets it", async () => {
    const { web, cookie, userId } = await arrange();

    const saved = await web.call(cookie, "PUT", "/api/template", { fields: { ...ALL_OFF, synonyms: true } });
    expect(saved.body).toMatchObject({ custom: true, fields: { synonyms: true, examples: false } });
    expect((await web.bot.services.translationTemplateRepository.getByUserId(userId))?.fields).toMatchObject({
      synonyms: true,
      examples: false,
    });

    const preview = await web.call(cookie, "POST", "/api/template/preview", { fields: { ...ALL_OFF, synonyms: true } });
    const [ru] = (preview.body as { translations: { synonyms: string[]; examples: unknown[] }[] }).translations;
    expect(ru?.synonyms.length).toBeGreaterThan(0);
    expect(ru?.examples).toEqual([]);

    const reset = await web.call(cookie, "DELETE", "/api/template");
    expect(reset.body).toMatchObject({ custom: false });
    expect(await web.bot.services.translationTemplateRepository.getByUserId(userId)).toBeNull();
  });

  it("refuses a template with an unknown field", async () => {
    const { web, cookie } = await arrange();
    const res = await web.call(cookie, "PUT", "/api/template", { fields: { ...ALL_OFF, emoji: true } });
    expect(res.status).toBe(400);
  });

  it("shows a translated card without the sections the template turns off", async () => {
    const { web, cookie } = await arrange();
    await web.call(cookie, "PUT", "/api/template", { fields: ALL_OFF });

    const card = await web.call(cookie, "POST", "/api/translate", { text: "hello", sourceLang: "en" });

    expect(card.status).toBe(200);
    for (const translation of (card.body as { translations: { examples: unknown[]; synonyms: unknown[] }[] })
      .translations) {
      expect(translation.examples).toEqual([]);
      expect(translation.synonyms).toEqual([]);
    }
  });
});

describe("web plan screen", () => {
  it("shows the current plan, the catalog cheapest first and the bot upgrade link", async () => {
    const { web, cookie } = await arrange();

    const res = await web.call(cookie, "GET", "/api/plan");

    expect(res.status).toBe(200);
    const body = res.body as {
      current: { name: string; trial: boolean };
      plans: { name: string; priceUsdCents: number }[];
      upgradeUrl: string;
    };
    expect(body.current).toMatchObject({ name: "free", trial: false });
    const catalog = (await web.bot.services.settings.getPlanLimits()).filter((p) => p.isActive && p.priceUsdCents);
    expect(body.plans.map((p) => p.name).sort()).toEqual(catalog.map((p) => p.name).sort());
    const prices = body.plans.map((p) => p.priceUsdCents);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(body.upgradeUrl).toBe("https://t.me/harness_bot?start=plan");
  });

  it("names the features a paid plan unlocks", async () => {
    const { web, cookie } = await arrange({ plan: "pro" });

    const body = (await web.call(cookie, "GET", "/api/plan")).body as { current: { name: string; features: string[] } };

    expect(body.current.name).toBe("pro");
    expect(body.current.features).toContain("pronunciation");
  });
});

describe("web release notes", () => {
  it("are refused to a regular user and shown to a tester", async () => {
    const { web, cookie, userId } = await arrange();
    expect((await web.call(cookie, "GET", "/api/changes")).status).toBe(403);

    await web.bot.services.userRepository.updateAudienceGroup(userId, "tester");
    const res = await web.call(cookie, "GET", "/api/changes");

    expect(res.status).toBe(200);
    expect(Array.isArray((res.body as { notes: unknown }).notes)).toBe(true);
  });
});

describe("web issue report", () => {
  it("lands where the bot's reports land", async () => {
    const { web, cookie, userId } = await arrange();

    const res = await web.call(cookie, "POST", "/api/report", {
      type: "bug",
      description: "The play button is silent",
    });

    expect(res.status).toBe(204);
    const [issue] = await reportedIssueRepository.findByUser(userId);
    expect(issue).toMatchObject({ type: "bug", description: "The play button is silent" });
  });

  it("refuses an empty or over-long report", async () => {
    const { web, cookie } = await arrange();
    for (const description of ["   ", "x".repeat(1001)]) {
      expect((await web.call(cookie, "POST", "/api/report", { type: "bug", description })).status).toBe(400);
    }
  });
});
