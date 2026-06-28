/**
 * Telegram message renderers for video vocabulary feature.
 */

import type { VideoPhrase, VideoProcess } from "@polyglot/core";
import { type SupportedLang, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";

export function renderConfirmation(
  metadata: { title: string; durationSeconds: number; language: string },
  remaining: number,
  monthlyLimit: number,
  lang: SupportedLang,
): string {
  const duration = formatDuration(metadata.durationSeconds, lang);
  return [
    `<b>🎬 ${escapeHtml(metadata.title)}</b>`,
    "",
    `⏱ ${t("videoDuration", lang)}: ${duration}`,
    `🌐 ${t("videoLanguage", lang)}: ${metadata.language}`,
    `📊 ${t("videoRemaining", lang)}: ${remaining}/${monthlyLimit}`,
  ].join("\n");
}

export function buildConfirmationKeyboard(processId: number, lang: SupportedLang): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("videoExtract", lang), `vid:confirm:${processId}`)
    .text(t("videoCancel", lang), `vid:cancel:${processId}`);
}

export function renderPhraseList(
  phrases: VideoPhrase[],
  page: number,
  totalPages: number,
  videoUrl: string,
  lang: SupportedLang,
): string {
  if (phrases.length === 0) {
    return t("videoNoPhrases", lang);
  }

  const lines: string[] = [];
  for (const phrase of phrases) {
    const typeLabel = phrase.phraseType
      ? `[${phrase.phraseType === "word" ? t("videoTypeWord", lang) : t("videoTypePhrase", lang)}]`
      : "";
    const levelLabel = phrase.level ? `(${phrase.level})` : "";
    const saved = phrase.savedEntryId ? " ✅" : "";
    const timestamp = phrase.timestampSeconds != null ? formatTimestamp(phrase.timestampSeconds) : "";
    const linkTime = phrase.timestampSeconds != null ? Math.max(0, phrase.timestampSeconds - 3) : null;
    const deepLink = linkTime != null ? `<a href="${videoUrl}&amp;t=${linkTime}">▶️ ${timestamp}</a>` : "";

    const emojiPrefix = phrase.emoji ? `${phrase.emoji} ` : "🔹 ";
    lines.push(`${emojiPrefix}<b>${escapeHtml(phrase.phrase)}</b> ${typeLabel} ${levelLabel}${saved}`);
    if (phrase.nativeTranslation) {
      lines.push(`→ ${escapeHtml(phrase.nativeTranslation)}`);
    }
    if (phrase.context) {
      lines.push(`<i>"${escapeHtml(phrase.context)}"</i>`);
    }
    if (deepLink) {
      lines.push(deepLink);
    }
    lines.push("");
  }

  lines.push(`📄 ${t("videoPage", lang, { page, total: totalPages })}`);
  return lines.join("\n");
}

export function buildPhraseListKeyboard(
  phrases: VideoPhrase[],
  page: number,
  totalPages: number,
  processId: number,
  lang: SupportedLang,
): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (const phrase of phrases) {
    if (phrase.savedEntryId) {
      kb.text(`✅ ${truncate(phrase.phrase, 20)}`, `vid:noop:${phrase.id}`);
    } else {
      kb.text(`💾 ${truncate(phrase.phrase, 20)}`, `vid:save:${phrase.id}`);
    }
    kb.row();
  }

  const navRow: Array<[string, string]> = [];
  if (page > 1) {
    navRow.push(["⬅️", `vid:browse:${processId}:${page - 1}`]);
  }
  if (page < totalPages) {
    navRow.push(["➡️", `vid:browse:${processId}:${page + 1}`]);
  }
  for (const [text, data] of navRow) {
    kb.text(text, data);
  }
  if (navRow.length > 0) kb.row();

  // Show "Save All" only if there are unsaved phrases
  const hasUnsaved = phrases.some((p) => !p.savedEntryId);
  if (hasUnsaved) {
    kb.text(t("videoSaveAll", lang), `vid:saveall:${processId}`).row();
  }

  kb.text(t("videoClose", lang), "vid:close");
  return kb;
}

export function renderVideoList(
  processes: VideoProcess[],
  page: number,
  totalPages: number,
  lang: SupportedLang,
): string {
  if (processes.length === 0) {
    return t("videoNoVideos", lang);
  }

  const lines: string[] = [`<b>📹 ${t("videoMyVideos", lang)}</b>`, ""];

  for (const p of processes) {
    const date = p.createdAt.toLocaleDateString("en-CA"); // YYYY-MM-DD
    const icon =
      p.status === "completed" ? "🎬" : p.status === "processing" ? "⏳" : p.status === "failed" ? "❌" : "⏳";
    const title = p.title ? escapeHtml(truncate(p.title, 40)) : p.videoId;
    lines.push(`${icon} <b>${title}</b> — ${date}`);
  }

  if (totalPages > 1) {
    lines.push("");
    lines.push(`📄 ${t("videoPage", lang, { page, total: totalPages })}`);
  }

  return lines.join("\n");
}

export function buildVideoListKeyboard(
  processes: VideoProcess[],
  page: number,
  totalPages: number,
  lang: SupportedLang,
): InlineKeyboard {
  const kb = new InlineKeyboard();

  for (const p of processes) {
    if (p.status === "completed") {
      kb.text(`📖 ${truncate(p.title ?? p.videoId, 25)}`, `vid:browse:${p.id}:1`).row();
    }
  }

  const navRow: Array<[string, string]> = [];
  if (page > 1) {
    navRow.push(["⬅️", `vid:list:${page - 1}`]);
  }
  if (page < totalPages) {
    navRow.push(["➡️", `vid:list:${page + 1}`]);
  }
  for (const [text, data] of navRow) {
    kb.text(text, data);
  }
  if (navRow.length > 0) kb.row();

  kb.text(t("videoClose", lang), "vid:close");
  return kb;
}

/* ---- Helpers ---- */

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

function formatDuration(seconds: number, lang: SupportedLang): string {
  if (seconds <= 0) return t("videoDurationUnknown", lang);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
