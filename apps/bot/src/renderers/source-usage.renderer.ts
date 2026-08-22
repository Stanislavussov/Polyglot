import type { SourceUsage } from "@polyglot/core";
import { getLangFlag } from "@polyglot/core";
import { expandableSection } from "./card-sections.js";

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderSourceUsage(
  original: string,
  sourceLang: string,
  usage: SourceUsage | null | undefined,
): string[] {
  if (!usage) return [];

  const sourceFlag = getLangFlag(sourceLang) ?? "🔤";
  const synonyms = usage.synonyms.length > 0 ? ` (${usage.synonyms.map((item) => esc(item.text)).join(", ")})` : "";
  const lines = [`${sourceFlag} <b>${esc(original)}</b>${synonyms}`];

  const details: string[] = [];
  if (usage.examples.length > 0) {
    const [first, ...rest] = usage.examples.map(
      (ex) => `💬 <i>${esc(ex.target)}</i>${ex.native ? ` (${esc(ex.native)})` : ""}`,
    );
    lines.push(first!);
    details.push(...rest);
  }
  if (usage.explanation) {
    details.push(`ℹ️ ${esc(usage.explanation)}`);
  }
  lines.push(...expandableSection(details));

  return lines;
}

export function renderCompactSourceExample(sourceLang: string, usage: SourceUsage | null | undefined): string | null {
  const example = usage?.examples[0];
  if (!example) return null;

  const sourceFlag = getLangFlag(sourceLang) ?? "🔤";
  const native = example.native ? ` (${esc(example.native)})` : "";
  return `${sourceFlag} 💬 <i>${esc(example.target)}</i>${native}`;
}
