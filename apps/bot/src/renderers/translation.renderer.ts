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
  DictionaryContext,
} from "@polyglot/core";
import { t, isSupported } from "@polyglot/core";

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

  if (output.dictionaryContext) {
    lines.push(renderDictionaryHint(output.dictionaryContext, lang));
    lines.push("");
  }

  if (output.needsReview) {
    lines.push(esc(t("translationNeedsReview", lang)));
  }

  return lines.join("\n").trim();
}

/** Render a dictionary context hint section */
export function renderDictionaryHint(
  dc: DictionaryContext,
  lang: SupportedLang,
): string {
  const lines: string[] = [];

  if (dc.pos === "phrase") {
    lines.push(esc(t("phraseDetected", lang, { phrase: dc.word })));
  } else if (dc.pos === "idiom") {
    lines.push(esc(t("idiomDetected", lang, { idiom: dc.word })));
  } else {
    lines.push(esc(t("partOfSpeech", lang, { pos: dc.pos })));
  }

  if (dc.glosses.length > 0) {
    const glossText = dc.glosses.slice(0, 3).join("; ");
    lines.push(`📖 ${esc(glossText)}`);
  }

  return lines.join("\n");
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

  lines.push(`🔤 ${esc(code.toUpperCase())}: ${header}`);
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
    lines.push(`🔤 ${esc(code.toUpperCase())}: ${header}`);
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
