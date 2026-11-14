/**
 * Spec — the dictionary card's "Ask" page and the entry dialog:
 *
 * 1. Etymology for a saved word is generated once, kept on the entry, shown with it, and
 *    served from the entry afterwards without calling the model again. Free gets 403.
 * 2. The mentor answers about a saved word with that card in its prompt.
 * 3. "Review more often" sets the entry's grade to hard; another learner's entry is a 404.
 */
import { getLang, vocabularyRepository } from "@polyglot/adapter-db";
import type { AIPort } from "@polyglot/core";
import { describe, expect, it, vi } from "vitest";
import { arrangeOnboardedTranslator } from "../../bot/src/test-helpers/integration/arrange.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { createWebHarness } from "./test-helpers/web-harness.js";

const ORIGIN = "From Old English hǣl, a wish of good health.";

async function arrange(plan: string) {
  const generateObject = vi.fn<AIPort["generateObject"]>(async (_prompt, schema) =>
    schema.parse({ etymology: ORIGIN }),
  );
  const generateChat = vi.fn<AIPort["generateChat"]>().mockResolvedValue("<b>Hello</b> is a friendly greeting.");
  const web = await createWebHarness({ ai: { generateObject, generateChat } });
  const telegramId = uniqueTelegramId();
  // Native cs, learning en: "hello" is a learning-language word, so etymology applies.
  const userId = await arrangeOnboardedTranslator(telegramId, { nativeLang: "cs", learningLangs: ["en"], plan });
  const entry = await vocabularyRepository.create(userId, {
    original: "hello",
    sourceLangId: getLang("en")!.id,
    inputType: "word",
    unverified: false,
    translations: [{ targetLangId: getLang("cs")!.id, text: "ahoj", details: { synonyms: [], examples: [] } }],
  });
  const { cookie } = await web.login(telegramId);
  return { web, cookie, entry, generateObject, generateChat };
}

describe("dictionary entry explore", () => {
  it("keeps a generated etymology on the entry and never pays for it twice", async () => {
    const { web, cookie, entry, generateObject } = await arrange("pro");

    const first = await web.call(cookie, "POST", `/api/dictionary/${entry.id}/etymology`);
    expect(first).toEqual({ status: 200, body: { etymology: ORIGIN } });
    const detail = (await web.call(cookie, "GET", `/api/dictionary/${entry.id}`)).body as { etymology: string | null };
    expect(detail.etymology).toBe(ORIGIN);

    const again = await web.call(cookie, "POST", `/api/dictionary/${entry.id}/etymology`);
    expect(again).toEqual({ status: 200, body: { etymology: ORIGIN } });
    expect(generateObject).toHaveBeenCalledTimes(1);
  });

  it("refuses etymology on Free without calling the model", async () => {
    const { web, cookie, entry, generateObject } = await arrange("free");
    const res = await web.call(cookie, "POST", `/api/dictionary/${entry.id}/etymology`);
    expect(res.status).toBe(403);
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("answers mentor questions about the saved word", async () => {
    const { web, cookie, entry, generateChat } = await arrange("pro");
    const res = await web.call(cookie, "POST", `/api/dictionary/${entry.id}/mentor`, { question: "When do I say it?" });
    expect(res).toEqual({
      status: 200,
      body: { question: "When do I say it?", answer: "<b>Hello</b> is a friendly greeting." },
    });
    const prompt = JSON.stringify(generateChat.mock.calls[0]?.[0]);
    expect(prompt).toContain("hello");
    expect(prompt).toContain("ahoj");
  });

  it("marks a word to come back more often, only for its owner", async () => {
    const { web, cookie, entry } = await arrange("free");
    expect(
      (await web.call(cookie, "PUT", `/api/dictionary/${entry.id}/difficulty`, { difficulty: "hard" })).status,
    ).toBe(204);
    const detail = (await web.call(cookie, "GET", `/api/dictionary/${entry.id}`)).body as { difficulty: string | null };
    expect(detail.difficulty).toBe("hard");

    const stranger = await arrange("free");
    expect(
      (
        await stranger.web.call(stranger.cookie, "PUT", `/api/dictionary/${entry.id}/difficulty`, {
          difficulty: "hard",
        })
      ).status,
    ).toBe(404);
  });
});
