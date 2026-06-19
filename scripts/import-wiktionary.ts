#!/usr/bin/env tsx
/**
 * Import Wiktionary JSONL data into word_context table.
 *
 * Usage:
 *   pnpm import:wiktionary <jsonl-files...> [--batch-size=1000] [--lang=ru]
 *
 * Examples:
 *   pnpm import:wiktionary ./data/kaikki.org-dictionary-Russian.jsonl
 *   pnpm import:wiktionary ./data/*.jsonl --batch-size=5000
 *   pnpm import:wiktionary ./data/russian.jsonl --lang=ru
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import {
  closeDb,
  languageRepository,
  wordContextRepository,
  loadLanguageCache,
  normalizeToIso1,
  getLangName,
} from "@polyglot/adapter-db";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface ParsedEntry {
  word: string;
  langCode: string;
  langName: string;
  pos: string;
  forms: string[];
  formTags: string[];
  glosses: string[];
}

interface ImportStats {
  total: number;
  inserted: number;
  skipped: number;
  errors: number;
  duration: number;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function normalizeLookupValue(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readForms(value: unknown): Array<{ form: string; tags: string[] }> {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.form !== "string") return [];
    return [{ form: normalizeLookupValue(item.form), tags: readStringArray(item.tags) }];
  });
}

function readGlosses(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((sense) => (isRecord(sense) ? readStringArray(sense.glosses) : []));
}

// ─────────────────────────────────────────────
// Env loader (only DATABASE_URL required)
// ─────────────────────────────────────────────
function loadEnv(): void {
  dotenvConfig(); // loads from .env in cwd (monorepo root)

  if (!process.env["DATABASE_URL"]) {
    console.error("❌ DATABASE_URL environment variable is not set");
    console.error("   Set it in .env or export it before running this script.");
    process.exit(1);
  }
}

// ─────────────────────────────────────────────
// JSONL Parser (streaming)
// ─────────────────────────────────────────────
async function* parseJsonl(filePath: string): AsyncGenerator<ParsedEntry> {
  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed)) continue;

      // Skip entries without required fields
      if (
        typeof parsed.word !== "string" ||
        typeof parsed.lang_code !== "string" ||
        typeof parsed.pos !== "string"
      ) {
        continue;
      }

      // Normalize lang_code to ISO 639-1 (e.g. "ces" → "cs", "ru" → "ru")
      const rawCode = parsed.lang_code;
      const normalizedCode = normalizeToIso1(rawCode) ?? rawCode;
      // Use canonical name from our registry, fall back to Wiktionary's lang field
      const langName = getLangName(normalizedCode);
      const resolvedName =
        langName !== normalizedCode ? langName : typeof parsed.lang === "string" ? parsed.lang : normalizedCode;
      const parsedForms = readForms(parsed.forms);

      yield {
        word: normalizeLookupValue(parsed.word),
        langCode: normalizedCode,
        langName: resolvedName,
        pos: parsed.pos,
        forms: parsedForms
          .filter(({ tags }) => !tags.includes("romanization"))
          .map(({ form }) => form)
          .filter((form, index, forms) => form !== normalizeLookupValue(parsed.word) && forms.indexOf(form) === index),
        formTags: parsedForms[0]?.tags ?? [],
        glosses: readGlosses(parsed.senses),
      };
    } catch {
      // Skip malformed JSON lines
      continue;
    }
  }
}

// ─────────────────────────────────────────────
// Language Resolution (with in-memory cache)
// ─────────────────────────────────────────────
const languageCache = new Map<string, number>();

async function getOrCreateLanguageId(
  code: string,
  name: string,
): Promise<number> {
  const cached = languageCache.get(code);
  if (cached !== undefined) return cached;

  const lang = await languageRepository.getOrCreate(code, name);
  languageCache.set(code, lang.id);
  return lang.id;
}

// ─────────────────────────────────────────────
// Import a single file
// ─────────────────────────────────────────────
async function importFile(
  filePath: string,
  options: { batchSize: number; langFilter?: string },
): Promise<ImportStats> {
  const startTime = Date.now();
  const stats: ImportStats = {
    total: 0,
    inserted: 0,
    skipped: 0,
    errors: 0,
    duration: 0,
  };

  const batch: Array<{
    word: string;
    languageId: number;
    pos: string;
    forms: string[];
    formTags: string[];
    glosses: string[];
  }> = [];

  // Check file exists
  try {
    await stat(filePath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }

  console.log(`📖 Importing: ${filePath}`);

  for await (const entry of parseJsonl(filePath)) {
    stats.total++;

    // Apply language filter if specified
    if (options.langFilter && entry.langCode !== options.langFilter) {
      stats.skipped++;
      continue;
    }

    try {
      const languageId = await getOrCreateLanguageId(
        entry.langCode,
        entry.langName,
      );

      batch.push({
        word: entry.word,
        languageId,
        pos: entry.pos,
        forms: entry.forms,
        formTags: entry.formTags,
        glosses: entry.glosses,
      });

      // Flush batch when full
      if (batch.length >= options.batchSize) {
        const inserted = await wordContextRepository.createBatch(batch);
        stats.inserted += inserted;
        batch.length = 0;

        process.stdout.write(
          `\r   ⏳ Processed: ${stats.total.toLocaleString()} | Inserted: ${stats.inserted.toLocaleString()}`,
        );
      }
    } catch {
      stats.errors++;
    }
  }

  // Flush remaining batch
  if (batch.length > 0) {
    const inserted = await wordContextRepository.createBatch(batch);
    stats.inserted += inserted;
  }

  stats.duration = Date.now() - startTime;

  process.stdout.write(
    `\r   ✅ ${stats.inserted.toLocaleString()} entries in ${(stats.duration / 1000).toFixed(1)}s`,
  );
  if (stats.skipped > 0) process.stdout.write(` (${stats.skipped.toLocaleString()} skipped)`);
  if (stats.errors > 0) process.stdout.write(` (${stats.errors.toLocaleString()} errors)`);
  console.log("");

  return stats;
}

// ─────────────────────────────────────────────
// CLI Entry Point
// ─────────────────────────────────────────────
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "batch-size": { type: "string", default: "1000" },
      lang: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help || positionals.length === 0) {
    console.log(`
Usage: pnpm import:wiktionary <jsonl-files...> [options]

Options:
  --batch-size=N   Insert batch size (default: 1000)
  --lang=CODE      Filter by language code (e.g., ru, en, de)
  -h, --help       Show this help message

Examples:
  pnpm import:wiktionary ~/Downloads/phrases/kaikki.org-dictionary-Russian-by-pos-phrase.jsonl
  pnpm import:wiktionary ~/Downloads/phrases/*.jsonl --batch-size=5000
  pnpm import:wiktionary ~/Downloads/phrases/russian.jsonl --lang=ru
`);
    process.exit(0);
  }

  // Load DATABASE_URL from .env
  loadEnv();

  const batchSize = parseInt(values["batch-size"] ?? "1000", 10);
  const langFilter = values.lang;
  const files = positionals.map((f) => resolve(f));

  console.log(`📦 Batch size: ${batchSize}`);
  if (langFilter) console.log(`🌍 Language filter: ${langFilter}`);
  console.log(`📂 Files: ${files.length}`);
  console.log("");

  const totals: ImportStats = {
    total: 0,
    inserted: 0,
    skipped: 0,
    errors: 0,
    duration: 0,
  };

  const startTime = Date.now();

  try {
    // Load language cache for normalization (ISO 639-3 → ISO 639-1)
    await loadLanguageCache();
    for (const file of files) {
      const stats = await importFile(file, { batchSize, langFilter });
      totals.total += stats.total;
      totals.inserted += stats.inserted;
      totals.skipped += stats.skipped;
      totals.errors += stats.errors;
    }

    totals.duration = Date.now() - startTime;

    if (files.length > 1) {
      console.log("");
      console.log(`📊 Total:`);
      console.log(`   Entries:   ${totals.total.toLocaleString()}`);
      console.log(`   Inserted:  ${totals.inserted.toLocaleString()}`);
      console.log(`   Skipped:   ${totals.skipped.toLocaleString()}`);
      console.log(`   Errors:    ${totals.errors.toLocaleString()}`);
      console.log(`   Duration:  ${(totals.duration / 1000).toFixed(2)}s`);
    }
  } catch (err) {
    console.error("❌ Import failed:", err);
    process.exit(1);
  } finally {
    await closeDb();
  }
}

main();
