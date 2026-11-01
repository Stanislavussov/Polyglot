import { describe, expect, it, vi } from "vitest";
import type { GenerateObjectFn } from "../../ports/ai.port.js";
import { generateExpression } from "./expression-generate.js";

const reply = {
  expression: "Be a goldfish",
  meaning: "Быстро забудь неудачу",
  translation: "Будь золотой рыбкой",
  sourceKind: "series" as const,
  sourceTitle: "Ted Lasso",
  example: "Missed the penalty? Be a goldfish.",
};

function fakeAi(result: unknown = reply) {
  return vi.fn(async () => result) as unknown as GenerateObjectFn & ReturnType<typeof vi.fn>;
}

describe("generateExpression", () => {
  it("asks the model once with a high temperature and returns the expression with its language", async () => {
    const ai = fakeAi();
    const result = await generateExpression(
      { userId: 1, nativeLang: "ru", learningLangs: ["en"], seed: 5, avoid: ["Carpe diem"] },
      { generateObjectFn: ai, modelId: "m" },
    );

    expect(ai).toHaveBeenCalledTimes(1);
    const [prompt, , model, options] = ai.mock.calls[0] ?? [];
    expect(model).toBe("m");
    expect(options).toMatchObject({ userId: 1, temperature: expect.any(Number) });
    expect((options as { temperature: number }).temperature).toBeGreaterThanOrEqual(0.8);
    expect(prompt).toContain("Carpe diem");
    expect(["ru", "en"]).toContain(result.lang);
    expect(result.expression).toBe("Be a goldfish");
  });

  it("drops the translation when the expression is in the native language", async () => {
    const result = await generateExpression(
      { userId: 1, nativeLang: "ru", learningLangs: [], seed: 5, avoid: [] },
      { generateObjectFn: fakeAi(), modelId: "m" },
    );
    expect(result.lang).toBe("ru");
    expect(result.translation).toBeUndefined();
  });

  it("does not list the native language twice when it is also being learned", async () => {
    const langs = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      const result = await generateExpression(
        { userId: 1, nativeLang: "ru", learningLangs: ["ru", "en"], seed, avoid: [] },
        { generateObjectFn: fakeAi(), modelId: "m" },
      );
      langs.add(result.lang);
    }
    expect(langs).toEqual(new Set(["ru", "en"]));
  });
});
