/**
 * Spec — the web card's Explore actions, the bot's expanded card (`tr:more`) on the web:
 *
 * 1. A translated card says which paid actions the plan includes and whether etymology applies.
 * 2. Clarify re-runs the translation with the user's context; Free gets 403 feature_locked.
 * 3. Other meaning sends the shown translations as constraints; Free gets 403 feature_locked.
 *    (No sense left → no_more_meanings is pinned in core's run-translation spec: an answered
 *    re-run skips the existence guard the AI mock could otherwise use to ask a question.)
 * 4. Etymology answers for an eligible word, 422 for native-language input, 403 on Free.
 * 5. The mentor answers with the card in its prompt, bills one "[mentor]" ledger row, carries
 *    the client-held thread, refuses Free with 403, and stops at the plan's daily cap with 429.
 */
import type { AIPort } from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";
import { arrangeOnboardedTranslator } from "../../bot/src/test-helpers/integration/arrange.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../bot/src/test-helpers/integration/translate-ai-mock.js";
import { createWebHarness } from "./test-helpers/web-harness.js";

type Card = Record<string, unknown> & {
  translations: { lang: string; text: string }[];
  features: { clarification: boolean; mentor: boolean; etymology: boolean };
  etymologyEligible: boolean;
};

function exploreAi(overrides: Partial<AIPort> = {}): Partial<AIPort> {
  const base = deterministicTranslateAi();
  const generateObject: AIPort["generateObject"] = async (prompt, schema, ...rest) => {
    const etymology = schema.safeParse({ etymology: "From Old English hǣl, a wish of good health." });
    if (prompt.includes("etymology") && etymology.success) return etymology.data;
    return base.generateObject!(prompt, schema, ...rest);
  };
  return {
    ...base,
    generateObject,
    generateChat: vi.fn().mockResolvedValue("<b>Hello</b> is a friendly greeting."),
    ...overrides,
  };
}

async function arrange(plan?: string, ai: Partial<AIPort> = exploreAi(), nativeLang = "cs") {
  const web = await createWebHarness({ ai });
  const telegramId = uniqueTelegramId();
  // Native cs, learning en: "hello" is a word in a learning language, so etymology applies.
  const userId = await arrangeOnboardedTranslator(telegramId, {
    nativeLang,
    learningLangs: [nativeLang === "cs" ? "en" : "cs"],
    ...(plan ? { plan } : {}),
  });
  const { cookie } = await web.login(telegramId);
  const card = (await web.call(cookie, "POST", "/api/translate", { text: "hello", sourceLang: "en" })).body as Card;
  return { web, cookie, userId, card };
}

describe("web card explore", () => {
  it("tells a Free card its paid actions are locked and refuses each one", async () => {
    const { web, cookie, card } = await arrange();

    expect(card.features).toEqual({ clarification: false, mentor: false, etymology: false });
    expect(card.etymologyEligible).toBe(true);
    const locked = { code: "feature_locked" };
    expect(
      await web.call(cookie, "POST", "/api/translate", {
        text: "hello",
        sourceLang: "en",
        context: "a",
        clarify: true,
      }),
    ).toEqual({ status: 403, body: { ...locked, feature: "clarification" } });
    expect(
      await web.call(cookie, "POST", "/api/translate", {
        text: "hello",
        sourceLang: "en",
        negativeConstraints: { cs: ["ahoj"] },
      }),
    ).toEqual({ status: 403, body: { ...locked, feature: "clarification" } });
    expect(
      await web.call(cookie, "POST", "/api/translate/etymology", {
        original: "hello",
        sourceLang: "en",
        inputType: "word",
      }),
    ).toEqual({ status: 403, body: { ...locked, feature: "etymology" } });
    expect(await web.call(cookie, "POST", "/api/mentor", { card, explain: true })).toEqual({
      status: 403,
      body: { ...locked, feature: "mentor" },
    });
  });

  it("clarifies and finds another meaning on a paid plan", async () => {
    const { web, cookie, card } = await arrange("pro");
    expect(card.features).toEqual({ clarification: true, mentor: true, etymology: true });

    const clarified = await web.call(cookie, "POST", "/api/translate", {
      text: "hello",
      sourceLang: "en",
      context: "on the phone",
      clarify: true,
    });
    expect(clarified.status).toBe(200);
    expect((clarified.body as { context: string }).context).toBe("on the phone");

    const other = await web.call(cookie, "POST", "/api/translate", {
      text: "hello",
      sourceLang: "en",
      negativeConstraints: { cs: ["ahoj"] },
    });
    expect(other.status).toBe(200);
  });

  it("explains where an eligible word comes from, and refuses native-language input", async () => {
    const { web, cookie } = await arrange("pro");

    const res = await web.call(cookie, "POST", "/api/translate/etymology", {
      original: "hello",
      sourceLang: "en",
      inputType: "word",
    });
    expect(res).toEqual({ status: 200, body: { etymology: "From Old English hǣl, a wish of good health." } });

    const native = await web.call(cookie, "POST", "/api/translate/etymology", {
      original: "ahoj",
      sourceLang: "cs",
      inputType: "word",
    });
    expect(native).toEqual({ status: 422, body: { code: "not_eligible" } });
  });

  it("answers a question about the card, bills it, and keeps the thread the client holds", async () => {
    const ai = exploreAi();
    const { web, cookie, userId, card } = await arrange("plus", ai);
    const generateChat = vi.mocked(ai.generateChat!);

    const first = await web.call(cookie, "POST", "/api/mentor", { card, question: "Is it formal?" });
    expect(first).toEqual({
      status: 200,
      body: { question: "Is it formal?", answer: "<b>Hello</b> is a friendly greeting." },
    });
    const firstTurn = generateChat.mock.calls[0]![0];
    expect(firstTurn[0]!.role).toBe("system");
    expect(firstTurn.at(-1)!.content).toContain("--- CARD ---");
    expect(firstTurn.at(-1)!.content).toContain("Translation into cs: ahoj");
    expect(firstTurn.at(-1)!.content).toContain("Is it formal?");
    expect(
      await web.bot.services.translationRequestRepository.countRequestsInWindow(userId, "[mentor]", new Date(0)),
    ).toBe(1);

    await web.call(cookie, "POST", "/api/mentor", {
      card,
      question: "And in writing?",
      history: [
        { role: "user", content: "Is it formal?" },
        { role: "assistant", content: "<b>Hello</b> is a friendly greeting." },
      ],
    });
    const followUp = generateChat.mock.calls[1]![0];
    expect(followUp.map((turn) => turn.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(followUp[1]!.content).toContain("--- CARD ---");
    expect(followUp.at(-1)).toEqual({ role: "user", content: "And in writing?" });
  });

  it("stops the mentor at the plan's daily cap without calling the AI", async () => {
    const ai = exploreAi();
    const { web, cookie, userId, card } = await arrange("plus", ai);
    const ledger = web.bot.services.translationRequestRepository;
    for (let turn = 0; turn < 30; turn += 1) await ledger.logTranslationRequest(userId, "[mentor]", null, [], 0);

    const res = await web.call(cookie, "POST", "/api/mentor", { card, explain: true });

    expect(res).toEqual({ status: 429, body: { code: "mentor_limit", limit: 30 } });
    expect(ai.generateChat).not.toHaveBeenCalled();
  });
});
