/**
 * Renders AI translation output and topic words for Telegram.
 * Uses HTML parse mode for safe rendering of dynamic content.
 */
import { InlineKeyboard } from "grammy";
import type {
  TranslateOutput,
  LanguageTranslation,
  TopicWord,
  LanguageTranslationEntry,
  SupportedLang,
} from "@polyglot/core";
import { t, isSupported, getLangFlag } from "@polyglot/core";

/** Escape HTML special characters for Telegram */
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Resolve a string to SupportedLang with "en" fallback */
function toLang(lang?: string): SupportedLang {
  return lang && isSupported(lang) ? lang : "en";
}

/**
 * Render a full AI translation card for Telegram (HTML).
 *
 * Shows emoji, original word, register, and per-language translations
 * with CEFR level, synonyms, and contextual examples.
 */
export function renderTranslation(
  output: TranslateOutput,
  interfaceLang?: string,
): string {
  const lang = toLang(interfaceLang);
  const lines: string[] = [];

  lines.push(`${esc(output.emoji)} <b>${esc(output.original)}</b>`);
  lines.push(esc(t("register", lang, { register: output.register })));
  lines.push("");

  for (const [code, translation] of Object.entries(output.translations)) {
    lines.push(renderLangBlock(code, translation, lang));
    lines.push("");
  }

  // Dictionary context is NOT rendered to the user — it is only used
  // to enrich the AI prompt via the context-enrichment layer.

  if (output.needsReview) {
    lines.push(esc(t("translationNeedsReview", lang)));
  }

  return lines.join("\n").trim();
}

/** Render a single language translation block */
function renderLangBlock(
  code: string,
  lt: LanguageTranslation,
  lang: SupportedLang,
): string {
  const lines: string[] = [];

  const header = lt.transcription
    ? `<b>${esc(lt.text)}</b> [${esc(lt.transcription)}]`
    : `<b>${esc(lt.text)}</b>`;

  const flag = getLangFlag(code) ?? "🔤";
  lines.push(`${flag} ${esc(code.toUpperCase())}: ${header}`);

  if (lt.alternatives && lt.alternatives.length > 0) {
    for (const alt of lt.alternatives) {
      const altSyns = alt.synonyms.map(s => `${esc(s.text)} (${esc(s.register)})`).join(", ");
      lines.push(`   ∙ ${esc(alt.text)} (${esc(alt.register)})${altSyns ? ` — ${altSyns}` : ""}`);
    }
  }

  lines.push(
    `${esc(t("cefr", lang, { level: lt.cefr }))} · ${esc(lt.register)}`,
  );

  if (lt.synonyms.length > 0) {
    const synList = lt.synonyms
      .map((s) => `${esc(s.text)} (${esc(s.register)})`)
      .join(", ");
    lines.push(`${esc(t("synonyms", lang))}: ${synList}`);
  }

  if (lt.examples.length > 0) {
    lines.push(esc(t("examples", lang)) + ":");
    for (const ex of lt.examples) {
      const icon =
        ex.context === "formal"
          ? "📎"
          : ex.context === "professional"
            ? "💼"
            : "💬";
      lines.push(`  ${icon} <i>${esc(ex.target)}</i>`);
      lines.push(`  → ${esc(ex.native)}`);
    }
  }

  return lines.join("\n");
}

/**
 * Render a single topic word card for Telegram (HTML).
 *
 * Compact format showing the word and its translations per language.
 */
export function renderTopicWord(word: TopicWord): string {
  const lines: string[] = [];
  lines.push(`<b>${esc(word.original)}</b>`);
  lines.push("");

  for (const [code, entry] of Object.entries(word.translations)) {
    const e = entry as LanguageTranslationEntry;
    const header = e.transcription
      ? `<b>${esc(e.text)}</b> [${esc(e.transcription)}]`
      : `<b>${esc(e.text)}</b>`;
    const flag = getLangFlag(code) ?? "🔤";
    lines.push(`${flag} ${esc(code.toUpperCase())}: ${header}`);
  }

  return lines.join("\n").trim();
}

/**
 * Build inline keyboard with per-language regenerate buttons + save/skip.
 * Each regenerate button has callback data "tr:regen:<langCode>".
 */
export function buildTranslationKeyboard(
  langCodes: string[],
  interfaceLang?: string,
): InlineKeyboard {
  const lang = toLang(interfaceLang);
  const kb = new InlineKeyboard();

  // Row 1: regenerate buttons (one per language)
  for (const code of langCodes) {
    kb.text(
      t("regenerateLang", lang, { lang: code.toUpperCase() }),
      `tr:regen:${code}`,
    );
  }
  kb.row();

  // Row 2: save / skip
  kb.text(t("saveToDictionary", lang), "tr:save");
  kb.text(t("no", lang), "tr:skip");

  return kb;
}

/** Language option for source language selection keyboard */
export interface LangOption {
  code: string;
  name: string; // localized display name
}

/**
 * Build inline keyboard for post-translation source language selection.
 * Shows one button per configured language (native + learning).
 * Currently selected language is prefixed with ✓.
 *
 * Returns null when user has only 2 languages total (auto-detect sufficient).
 *
 * @param langs - All user languages (native + learning) with localized names
 * @param currentSelection - Currently selected source language code, or null
 * @returns InlineKeyboard or null if menu should not be shown
 */
export function buildSourceLangKeyboard(
  langs: LangOption[],
  currentSelection: string | null,
): InlineKeyboard | null {
  // Don't show menu when user has only 2 languages (1 native + 1 learning)
  if (langs.length <= 2) return null;

  const kb = new InlineKeyboard();

  for (const lang of langs) {
    const label =
      currentSelection === lang.code ? `✓ ${lang.name}` : lang.name;
    kb.text(label, `tr:srclang:${lang.code}`);
  }

  return kb;
}
