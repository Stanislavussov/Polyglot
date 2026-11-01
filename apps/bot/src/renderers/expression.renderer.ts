import type { ExpressionSourceKind, GeneratedExpression, SupportedLang } from "@polyglot/core";
import { t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { assembleCard, emptySections, esc, exampleLine, headwordLine, meaningLine } from "./card-sections.js";

/** "Another one" in the learn hub. Not a `lrn:` callback: those delete the message they sit on. */
export const EXPRESSION_MORE_CALLBACK = "expr:more";

const SOURCE_ICONS: Record<ExpressionSourceKind, string> = {
  film: "🎬",
  series: "📺",
  book: "📖",
  person: "👤",
  song: "🎵",
  folk: "🗣",
  history: "🏛",
  sport: "⚽",
  other: "💡",
};

function sourceLine(expression: GeneratedExpression, lang: SupportedLang): string | null {
  const title = expression.sourceTitle?.trim();
  if (title) return `${SOURCE_ICONS[expression.sourceKind]} ${esc(title)}`;
  if (expression.sourceKind === "folk") return `${SOURCE_ICONS.folk} ${esc(t("exprSourceFolk", lang))}`;
  return null;
}

/**
 * The expression must stay the card's only bold span: the save button (`notif:tr`)
 * reads the bold entity off the message to know what to translate and save.
 */
export function formatExpressionCard(
  expression: GeneratedExpression,
  lang: SupportedLang,
  options: { footer?: string } = {},
): string {
  const source = sourceLine(expression, lang);
  return assembleCard({
    ...emptySections(),
    headword: [headwordLine(expression.expression, { emoji: "🎭", sourceLang: expression.lang })],
    answer: expression.translation ? [`<i>${esc(expression.translation)}</i>`] : [],
    meaning: ["", meaningLine(expression.meaning), ...(source ? [source] : [])],
    examples: [exampleLine(expression.example)],
    footer: options.footer ? ["", options.footer] : [],
  });
}

/** `notif:tr` translates the bold expression and lands on the card with its save button. */
export const EXPRESSION_SAVE_CALLBACK = "notif:tr";

export function buildExpressionHubKeyboard(lang: SupportedLang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("exprSaveButton", lang), EXPRESSION_SAVE_CALLBACK)
    .text(t("exprMoreButton", lang), EXPRESSION_MORE_CALLBACK);
}
