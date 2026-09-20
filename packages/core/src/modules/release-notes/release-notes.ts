import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** Repo-relative home of the release notes; shipped inside the bot and admin-api images. */
export const RELEASES_DIR = join("@docs", "releases");

/** The queue of notes that have not reached every reader yet. */
export const UNRELEASED_DIR = join(RELEASES_DIR, "unreleased");

/** Telegram rejects any single message longer than this many characters. */
export const TELEGRAM_MAX_MESSAGE_CHARS = 4096;

export interface ReleaseNote {
  /** Hash of the English text — the per-reader dedup key across releases. */
  id: string;
  /** The note in the reader's language, or English when untranslated. */
  text: string;
}

/** One note with every translation the queue carries, for a sender that picks per reader. */
export interface TranslatedReleaseNote {
  id: string;
  /** Language code → text. `en` is always present; it is the spine. */
  texts: Record<string, string>;
}

/** One `- ` bullet is one note; everything else in the file is prose for us. */
export function parseNotes(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);
}

/**
 * The id follows the English text rather than the file position, so adding or
 * removing a note above another one does not re-announce the note below it.
 */
export function noteId(englishText: string): string {
  return createHash("sha256").update(englishText).digest("hex").slice(0, 12);
}

function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function findUp(startDir: string, relative: string): string | null {
  let dir = startDir;
  while (true) {
    const candidate = resolve(dir, relative);
    if (existsSync(candidate)) return candidate;

    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Walk up from `startDir` for the notes queue. Services run from `/app` in their
 * container and from a package directory in tests, so neither can hard-code it.
 */
export function findUnreleasedDir(startDir: string = process.cwd()): string | null {
  return findUp(startDir, UNRELEASED_DIR);
}

export function findReleasesDir(startDir: string = process.cwd()): string | null {
  return findUp(startDir, RELEASES_DIR);
}

/** What CI enforces the queue carries; English alone if the list cannot be read. */
export function readRequiredLanguages(releasesDir: string): string[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(releasesDir, "languages.json"), "utf8"));
    const required = (parsed as { required?: unknown }).required;
    if (Array.isArray(required) && required.every((lang): lang is string => typeof lang === "string")) {
      return required;
    }
  } catch {
    // Falls through: a missing or malformed list must not take the panel down.
  }
  return ["en"];
}

/**
 * Read the queue in `lang`, keeping English as the spine: ids are English, and a
 * translation whose bullet count differs cannot be paired by position without
 * risking a note reaching someone in the wrong language, so it is dropped whole.
 */
export function readNotes(dir: string, lang: string): ReleaseNote[] {
  const english = parseNotes(readIfExists(join(dir, "en.md")));
  if (english.length === 0) return [];

  const localized = lang === "en" ? english : parseNotes(readIfExists(join(dir, `${lang}.md`)));
  const paired = localized.length === english.length;

  return english.map((text, index) => ({
    id: noteId(text),
    text: (paired ? localized[index] : undefined) ?? text,
  }));
}

/** First language with a usable translation wins; English is the last resort. */
export function readNotesForReader(dir: string, langs: readonly (string | null | undefined)[]): ReleaseNote[] {
  const english = parseNotes(readIfExists(join(dir, "en.md")));
  if (english.length === 0) return [];

  for (const lang of langs) {
    if (!lang || lang === "en") continue;
    const localized = parseNotes(readIfExists(join(dir, `${lang}.md`)));
    if (localized.length === english.length) return readNotes(dir, lang);
  }

  return readNotes(dir, "en");
}

/** Which language `readNotesForReader` would answer in — for logs and `/changes`. */
export function pickNotesLang(dir: string, langs: readonly (string | null | undefined)[]): string {
  const englishCount = parseNotes(readIfExists(join(dir, "en.md"))).length;
  for (const lang of langs) {
    if (!lang || lang === "en") continue;
    if (parseNotes(readIfExists(join(dir, `${lang}.md`))).length === englishCount) return lang;
  }
  return "en";
}

/**
 * The whole queue, every language at once — what the admin panel offers to send
 * and what a send payload is built from. A language out of step with English is
 * left out rather than paired by position.
 */
export function readTranslatedNotes(dir: string): TranslatedReleaseNote[] {
  const english = parseNotes(readIfExists(join(dir, "en.md")));
  if (english.length === 0) return [];

  const translations = new Map<string, string[]>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".md") || file === "en.md") continue;
    const bullets = parseNotes(readIfExists(join(dir, file)));
    if (bullets.length === english.length) translations.set(file.slice(0, -3), bullets);
  }

  return english.map((text, index) => {
    const texts: Record<string, string> = { en: text };
    for (const [lang, bullets] of translations) {
      const translated = bullets[index];
      if (translated) texts[lang] = translated;
    }
    return { id: noteId(text), texts };
  });
}

/** The text a reader gets: their interface language, then native, then English. */
export function textForReader(note: TranslatedReleaseNote, langs: readonly (string | null | undefined)[]): string {
  for (const lang of langs) {
    if (lang && note.texts[lang]) return note.texts[lang];
  }
  return note.texts.en ?? "";
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** Cut to `budget` without leaving a dangling `&amp` — a half entity breaks the HTML parse. */
function truncateEscaped(escaped: string, budget: number): string {
  let body = escaped.slice(0, budget - 1);
  const lastAmp = body.lastIndexOf("&");
  if (lastAmp !== -1 && !body.slice(lastAmp).includes(";")) {
    body = body.slice(0, lastAmp);
  }
  return `${body.trimEnd()}…`;
}

/**
 * Render as many notes as fit one Telegram message, and report which ones went —
 * only those may be recorded as delivered, so a note pushed out by the limit is
 * still pending for the next send rather than silently lost.
 */
export function buildAnnouncementText(
  header: string,
  notes: readonly ReleaseNote[],
): { text: string; included: ReleaseNote[] } {
  const prefix = `<b>${escapeHtml(header)}</b>\n\n`;
  const budget = TELEGRAM_MAX_MESSAGE_CHARS - prefix.length;

  const included: ReleaseNote[] = [];
  const lines: string[] = [];
  let used = 0;

  for (const note of notes) {
    const line = `• ${escapeHtml(note.text)}`;
    const cost = lines.length === 0 ? line.length : line.length + 1;

    if (used + cost > budget) {
      // A single oversized note would otherwise block every later send: it never
      // fits, so it is never delivered, so it is always pending again.
      if (included.length === 0) {
        lines.push(truncateEscaped(line, budget));
        included.push(note);
      }
      break;
    }

    lines.push(line);
    included.push(note);
    used += cost;
  }

  return { text: `${prefix}${lines.join("\n")}`, included };
}
