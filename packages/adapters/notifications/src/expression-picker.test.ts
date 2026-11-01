import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLogger } = vi.hoisted(() => ({ mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

vi.mock("@polyglot/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@polyglot/core")>()),
  getLogger: vi.fn(() => mockLogger),
}));

import { createExpressionPicker } from "./expression-picker.js";

const user = { userId: 7, nativeLang: "ru", learningLangs: ["en"] };
const reply = {
  expression: "Be a goldfish",
  meaning: "Быстро забудь неудачу",
  translation: "Будь золотой рыбкой",
  sourceKind: "series",
  sourceTitle: "Ted Lasso",
  example: "Missed the penalty? Be a goldfish.",
};

describe("pickExpression", () => {
  beforeEach(() => vi.clearAllMocks());

  it("turns a generated expression into a notification word", async () => {
    const generateObject = vi.fn().mockResolvedValue(reply);
    const { pickExpression } = createExpressionPicker({
      generateObject,
      model: "m",
      now: () => new Date("2026-11-01T19:00:00Z"),
    });

    const word = await pickExpression(user, ["Carpe diem"]);

    expect(word).toMatchObject({ original: "Be a goldfish", emoji: "🎭", source: "expressions" });
    expect(word?.expression).toMatchObject({ meaning: "Быстро забудь неудачу", sourceTitle: "Ted Lasso" });
    expect(word?.sourceLang).toBe(word?.expression?.lang);
    expect(generateObject.mock.calls[0]?.[0]).toContain("Carpe diem");
  });

  it("asks a different angle for a different slot", async () => {
    const generateObject = vi.fn().mockResolvedValue(reply);
    let now = new Date("2026-11-01T09:00:00Z");
    const { pickExpression } = createExpressionPicker({ generateObject, model: "m", now: () => now });

    await pickExpression(user, []);
    now = new Date("2026-11-02T19:00:00Z");
    await pickExpression(user, []);

    expect(generateObject.mock.calls[0]?.[0]).not.toBe(generateObject.mock.calls[1]?.[0]);
  });

  it("returns null without calling AI when no model is configured", async () => {
    const generateObject = vi.fn();
    const { pickExpression } = createExpressionPicker({ generateObject });

    expect(await pickExpression(user, [])).toBeNull();
    expect(generateObject).not.toHaveBeenCalled();
  });

  it("returns null when the AI call fails", async () => {
    const generateObject = vi.fn().mockRejectedValue(new Error("down"));
    const { pickExpression } = createExpressionPicker({ generateObject, model: "m" });

    expect(await pickExpression(user, [])).toBeNull();
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
