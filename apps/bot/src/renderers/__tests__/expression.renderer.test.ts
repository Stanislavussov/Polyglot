import type { GeneratedExpression } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { buildExpressionHubKeyboard, formatExpressionCard } from "../expression.renderer.js";

const goldfish: GeneratedExpression = {
  lang: "en",
  expression: "Be a goldfish",
  meaning: "Быстро забудь неудачу и иди дальше.",
  translation: "Будь золотой рыбкой",
  sourceKind: "series",
  sourceTitle: "Ted Lasso",
  example: "Missed the penalty? Be a goldfish.",
};

function callbacks(kb: ReturnType<typeof buildExpressionHubKeyboard>): (string | undefined)[] {
  return kb.inline_keyboard.flat().map((button) => ("callback_data" in button ? button.callback_data : undefined));
}

describe("formatExpressionCard", () => {
  it("shows the expression, translation, meaning, source and example in that order", () => {
    const text = formatExpressionCard(goldfish, "ru");
    const order = ["Be a goldfish", "Будь золотой рыбкой", "Быстро забудь", "Ted Lasso", "Missed the penalty"].map(
      (part) => text.indexOf(part),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain("📺");
  });

  it("bolds the expression and nothing else, so the save button can read it back", () => {
    const text = formatExpressionCard(goldfish, "ru");
    expect(text.match(/<b>/g)).toHaveLength(1);
    expect(text).toContain("<b>Be a goldfish</b>");
  });

  it("labels a folk saying without a title and skips a missing translation", () => {
    const text = formatExpressionCard(
      {
        lang: "ru",
        expression: "Без труда не выловишь и рыбку из пруда",
        meaning: "Нужно стараться.",
        sourceKind: "folk",
        example: "Учись — без труда не выловишь и рыбку из пруда.",
      },
      "ru",
    );
    expect(text).toContain("Народная мудрость");
    expect(text.match(/<b>/g)).toHaveLength(1);
  });

  it("escapes HTML coming from the model", () => {
    expect(formatExpressionCard({ ...goldfish, meaning: "a < b & c" }, "en")).toContain("a &lt; b &amp; c");
  });
});

describe("buildExpressionHubKeyboard", () => {
  it("offers save and another one", () => {
    expect(callbacks(buildExpressionHubKeyboard("ru"))).toEqual(["notif:tr", "expr:more"]);
  });
});
