#!/usr/bin/env tsx
/**
 * Import Wiktionary JSONL data into word_context table.
 *
 * Usage:
 *   pnpm import:wiktionary <jsonl-file> [--batch-size=1000] [--lang=ru]
 *
 * Examples:
 *   pnpm import:wiktionary ./data/kaikki.org-dictionary-Russian.jsonl
 *   pnpm import:wiktionary ./data/russian.jsonl --batch-size=5000
 *   pnpm import:wiktionary ./data/russian.jsonl --lang=ru
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import {
  closeDb,
  getLangName,
  languageRepository,
  loadLanguageCache,
  normalizeToIso1,
  wordContextRepository,
} from "@polyglot/adapter-db";
import { loadConfig } from "../config.js";
import { logger } from "../logger.js";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
interface ParsedEntry {
  word: string;
  langCode: string;
  langName: string;
  pos: string;
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
      const entry = JSON.parse(line);

      // Skip entries without required fields
      if (!entry.word || !entry.lang_code || !entry.pos) continue;

      // Normalize lang_code to ISO 639-1 (e.g. "ces" → "cs", "ru" → "ru")
      const rawCode: string = entry.lang_code;
      const normalizedCode = normalizeToIso1(rawCode) ?? rawCode;
      // Use canonical name from our registry, fall back to Wiktionary's lang field
      const langName = getLangName(normalizedCode);
      const resolvedName = langName !== normalizedCode ? langName : (entry.lang ?? normalizedCode);

      yield {
        word: entry.word,
        langCode: normalizedCode,
        langName: resolvedName,
        pos: entry.pos,
        formTags: entry.forms?.[0]?.tags ?? [],
        glosses: entry.senses?.flatMap((s: any) => s.glosses ?? []) ?? [],
      };
    } catch {}
  }
}

// ─────────────────────────────────────────────
// Language Resolution (with in-memory cache)
// ─────────────────────────────────────────────
const languageCache = new Map<string, number>();

async function getOrCreateLanguageId(code: string, name: string): Promise<number> {
  const cached = languageCache.get(code);
  if (cached !== undefined) return cached;

  const lang = await languageRepository.getOrCreate(code, name);
  languageCache.set(code, lang.id);
  return lang.id;
}

// ─────────────────────────────────────────────
// Main Import Function
// ─────────────────────────────────────────────
async function importWiktionary(
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
    formTags: string[];
    glosses: string[];
  }> = [];

  // Check file exists
  try {
    await stat(filePath);
  } catch {
    throw new Error(`File not found: ${filePath}`);
  }

  logger.info({ filePath, batchSize: options.batchSize, langFilter: options.langFilter }, "Starting Wiktionary import");

  for await (const entry of parseJsonl(filePath)) {
    stats.total++;

    // Apply language filter if specified
    if (options.langFilter && entry.langCode !== options.langFilter) {
      stats.skipped++;
      continue;
    }

    try {
      const languageId = await getOrCreateLanguageId(entry.langCode, entry.langName);

      batch.push({
        word: entry.word,
        languageId,
        pos: entry.pos,
        formTags: entry.formTags,
        glosses: entry.glosses,
      });

      // Flush batch when full
      if (batch.length >= options.batchSize) {
        const inserted = await wordContextRepository.createBatch(batch);
        stats.inserted += inserted;
        batch.length = 0;

        // Progress indicator
        process.stdout.write(
          `\r⏳ Processed: ${stats.total.toLocaleString()} | Inserted: ${stats.inserted.toLocaleString()}`,
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

  logger.info({
    total: stats.total,
    inserted: stats.inserted,
    skipped: stats.skipped,
    errors: stats.errors,
    durationSec: +(stats.duration / 1000).toFixed(2),
  }, "Wiktionary import complete");

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
    logger.info({}, `Usage: pnpm import:wiktionary <jsonl-file> [options]\n\nOptions:\n  --batch-size=N   Insert batch size (default: 1000)\n  --lang=CODE      Filter by language code (e.g., ru, en, de)\n  -h, --help       Show this help message`);
    process.exit(0);
  }

  // Load environment configuration (finds .env automatically)
  loadConfig();

  const filePath = positionals[0]!;
  const batchSize = parseInt(values["batch-size"] ?? "1000", 10);
  const langFilter = values.lang;

  try {
    // Load language cache for normalization (ISO 639-3 → ISO 639-1)
    await loadLanguageCache();
    await importWiktionary(filePath, { batchSize, langFilter });
  } catch (err) {
    logger.error({ err }, "Import failed");
    process.exit(1);
  } finally {
    await closeDb();
  }
}

main();
