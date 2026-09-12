/**
 * Telegram renderers for the word picker — the angle list and one generated set.
 */

import type { SupportedLang, WordPickerItem, WordPickerPreset, WordPickerRun } from "@polyglot/core";
import { t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { answerLine, esc as escapeHtml, exampleLine, headwordLine, meaningLine } from "./card-sections.js";

export const PICK_PRESET_PREFIX = "wp:p:";
export const PICK_LANG_PREFIX = "wp:l:";
export const PICK_SAVE_PREFIX = "wp:s:";
export const PICK_SAVE_ALL_PREFIX = "wp:sa:";
export const PICK_MORE_PREFIX = "wp:m:";
export const PICK_CLOSE = "wp:close";
export const PICK_NOOP = "wp:noop";

/** The title an admin wrote for this interface language, or the default one. */
export function presetTitle(preset: WordPickerPreset, lang: SupportedLang): string {
  return preset.titleI18n[lang]?.trim() || preset.title;
}

export function renderPresetList(lang: SupportedLang): string {
  return t("pickIntro", lang);
}

export function buildPresetListKeyboard(presets: WordPickerPreset[], lang: SupportedLang): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const preset of presets) {
    kb.text(`${preset.emoji} ${truncate(presetTitle(preset, lang), 40)}`, `${PICK_PRESET_PREFIX}${preset.id}`).row();
  }
  kb.text(t("pickClose", lang), PICK_CLOSE);
  return kb;
}

/**
 * The language chooser, shown only when the learner studies more than one
 * language — with a single language there is nothing to choose.
 */
export function buildLangKeyboard(
  presetId: number,
  langs: Array<{ code: string; label: string }>,
  lang: SupportedLang,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const entry of langs) {
    kb.text(entry.label, `${PICK_LANG_PREFIX}${presetId}:${entry.code}`).row();
  }
  kb.text(t("pickClose", lang), PICK_CLOSE);
  return kb;
}

/**
 * One picked set: a header naming the preset, then one card per word.
 *
 * Each word is the same headword + answer + example the translate card uses, so
 * a word looks identical here and on the card it opens as. It stays to those
 * three lines because a set holds up to a dozen words — the shared grammar is
 * the line shapes, not the number of sections a single-word card can afford.
 */
export function renderPickedSet(
  run: WordPickerRun,
  items: WordPickerItem[],
  langLabel: string,
  lang: SupportedLang,
): string {
  const lines = [`${run.presetEmoji} <b>${escapeHtml(run.presetTitle)}</b> · ${escapeHtml(langLabel)}`, ""];

  for (const item of items) {
    const level = item.level ? ` <i>(${escapeHtml(item.level)})</i>` : "";
    const saved = item.savedEntryId ? " ✅" : "";
    lines.push(
      headwordLine(item.word, { emoji: item.emoji, sourceLang: run.langCode, badge: `${level}${saved}` }),
      answerLine(run.nativeLang, item.nativeTranslation),
    );
    if (item.exampleTarget) {
      lines.push(exampleLine(item.exampleTarget, item.exampleNative));
    }
    if (item.note) {
      lines.push(meaningLine(item.note));
    }
    lines.push("");
  }

  lines.push(t("pickHint", lang));
  return lines.join("\n");
}

export function buildPickedSetKeyboard(
  run: WordPickerRun,
  items: WordPickerItem[],
  lang: SupportedLang,
): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (const item of items) {
    if (item.savedEntryId) {
      kb.text(`✅ ${truncate(item.word, 24)}`, PICK_NOOP).row();
    } else {
      kb.text(`💾 ${truncate(item.word, 24)}`, `${PICK_SAVE_PREFIX}${item.id}`).row();
    }
  }

  if (items.some((item) => !item.savedEntryId)) {
    kb.text(`💾 ${t("pickSaveAll", lang)}`, `${PICK_SAVE_ALL_PREFIX}${run.id}`).row();
  }
  kb.text(`🔄 ${t("pickMore", lang)}`, `${PICK_MORE_PREFIX}${run.id}`).row();
  kb.text(t("pickClose", lang), PICK_CLOSE);
  return kb;
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}
