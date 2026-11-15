/**
 * Spec — the web card shows what is settled while the rest is still coming.
 *
 * 1. With `Accept: application/x-ndjson`, POST /api/translate answers one JSON line per
 *    step: previews (no save token — never saveable), then a `done` line equal in
 *    shape to the plain JSON reply.
 * 2. A finished run that ends in a question is the stream's last line as `error`, with
 *    the same status and body the plain reply carries; no preview shows a card for it.
 * 3. Without the header the reply stays one JSON body (covered by translate.integration.test.ts).
 */
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../bot/src/test-helpers/integration/arrange.js";
import { uniqueTelegramId } from "../../bot/src/test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../bot/src/test-helpers/integration/translate-ai-mock.js";
import { createWebHarness, WEB_ORIGIN } from "./test-helpers/web-harness.js";

type Line = { type: string; card?: Record<string, unknown>; status?: number; body?: Record<string, unknown> };

async function streamTranslate(web: Awaited<ReturnType<typeof createWebHarness>>, cookie: string, text: string) {
  const res = await web.app.inject({
    method: "POST",
    url: "/api/translate",
    headers: { cookie, accept: "application/x-ndjson", "content-type": "application/json", origin: WEB_ORIGIN },
    payload: { text },
  });
  const lines = res.body
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Line);
  return { res, lines };
}

describe("web translate stream", () => {
  it("sends previews first, then the final saveable card", async () => {
    const web = await createWebHarness({ ai: deterministicTranslateAi() });
    const telegramId = uniqueTelegramId();
    await arrangeOnboardedTranslator(telegramId, { nativeLang: "en", learningLangs: ["cs"] });
    const { cookie } = await web.login(telegramId);

    const { res, lines } = await streamTranslate(web, cookie, "hello");

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-ndjson");
    expect(res.headers["x-accel-buffering"]).toBe("no");
    const previews = lines.filter((line) => line.type === "preview");
    expect(previews.length).toBeGreaterThan(0);
    for (const preview of previews) expect(preview.card?.saveToken).toBeUndefined();
    expect(previews.at(-1)?.card?.translations).toContainEqual(expect.objectContaining({ lang: "cs", text: "ahoj" }));
    const done = lines.at(-1);
    expect(done?.type).toBe("done");
    expect(done?.card?.saveToken).toEqual(expect.any(String));
    expect(done?.card?.translations).toContainEqual(expect.objectContaining({ lang: "cs", text: "ahoj" }));
  });

  it("ends on the same question the plain reply asks, without a preview card", async () => {
    const web = await createWebHarness({
      ai: deterministicTranslateAi({ unrecognizedWord: "helo", suggestedCorrection: "hello" }),
    });
    const telegramId = uniqueTelegramId();
    await arrangeOnboardedTranslator(telegramId, { nativeLang: "en", learningLangs: ["cs"] });
    const { cookie } = await web.login(telegramId);

    const plain = await web.call(cookie, "POST", "/api/translate", { text: "helo" });
    const { lines } = await streamTranslate(web, cookie, "helo");

    const last = lines.at(-1);
    expect(last).toEqual({ type: "error", status: plain.status, body: plain.body });
    for (const line of lines.filter((l) => l.type === "preview")) {
      expect(line.card?.translations).toEqual([]);
    }
  });
});
