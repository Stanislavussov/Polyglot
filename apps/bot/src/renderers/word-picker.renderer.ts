/**
 * Telegram renderers for the word picker — the angle list and one generated set.
 */

import type { SupportedLang, WordPickerItem, WordPickerPreset, WordPickerRun } from "@polyglot/core";
import { t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";

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
    lines.push(`${item.emoji ?? "🔹"} <b>${escapeHtml(item.word)}</b>${level}${saved}`);
    lines.push(`→ ${escapeHtml(item.nativeTranslation)}`);
    if (item.exampleTarget) {
      const native = item.exampleNative ? `\n   ${escapeHtml(item.exampleNative)}` : "";
      lines.push(`<i>«${escapeHtml(item.exampleTarget)}»</i>${native}`);
    }
    if (item.note) {
      lines.push(`💡 ${escapeHtml(item.note)}`);
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

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}
