#!/usr/bin/env node
/**
 * CI gate for @docs/releases (see its README): every required language carries
 * the same notes as the English spine, and a change that a user could notice
 * arrives with a note.
 *
 * Run as `node scripts/check-release-notes.mjs [--base <ref>]`. Without a base
 * ref only the structure is checked — a fresh checkout has nothing to diff.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const RELEASES_DIR = join("@docs", "releases");
export const UNRELEASED_DIR = join(RELEASES_DIR, "unreleased");

/** Paths whose change a user could notice, so they need a note. */
const CODE_PREFIXES = ["apps/", "packages/", "deploy/", "scripts/", ".github/workflows/"];
const ROOT_CONFIG = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.json",
  "biome.json",
  "knip.json",
  "drizzle.config.ts",
  "vitest.config.ts",
  "vitest.integration.config.ts",
  ".dockerignore",
]);

export function parseBullets(markdown) {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0);
}

/**
 * A test-only or documentation-only change reaches no user, and the escape hatch
 * covers the rest — an internal refactor should not be able to force a fake note.
 */
export function needsNote(changedPaths) {
  return changedPaths.some((path) => {
    if (path.endsWith(".md")) return false;
    if (path.startsWith("@docs/") || path.startsWith(".claude/")) return false;
    if (/(^|\/)__tests__\//.test(path) || /\.(test|integration\.test)\.[cm]?[jt]sx?$/.test(path)) return false;
    return ROOT_CONFIG.has(path) || CODE_PREFIXES.some((prefix) => path.startsWith(prefix));
  });
}

export function notesChanged(changedPaths) {
  return changedPaths.some((path) => path.startsWith(`${UNRELEASED_DIR}/`));
}

export function hasSkipMarker(commitMessages) {
  return /\[skip notes\]/i.test(commitMessages);
}

/** @returns {string[]} problems, empty when the queue is valid. */
export function validateQueue(required, read) {
  const problems = [];
  const english = parseBullets(read("en.md") ?? "");

  if (english.length === 0) {
    problems.push(`${UNRELEASED_DIR}/en.md has no notes — every release note starts in English.`);
    return problems;
  }

  for (const lang of required) {
    if (lang === "en") continue;
    const content = read(`${lang}.md`);
    if (content === null) {
      problems.push(`${UNRELEASED_DIR}/${lang}.md is missing — ${lang} is a required language.`);
      continue;
    }
    const bullets = parseBullets(content);
    if (bullets.length !== english.length) {
      problems.push(
        `${UNRELEASED_DIR}/${lang}.md has ${bullets.length} note(s), en.md has ${english.length}. ` +
          `Same bullets, same order — a file out of step is dropped and everyone gets English.`,
      );
    }
  }

  return problems;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function main() {
  const baseIndex = process.argv.indexOf("--base");
  const base = baseIndex === -1 ? null : process.argv[baseIndex + 1];

  const required = JSON.parse(readFileSync(join(RELEASES_DIR, "languages.json"), "utf8")).required;
  const problems = validateQueue(required, (name) => {
    const path = join(UNRELEASED_DIR, name);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  });

  if (base) {
    let changed = null;
    try {
      changed = git(["diff", "--name-only", base, "HEAD"]).split("\n").filter(Boolean);
    } catch {
      // A shallow clone or a missing base ref is an infrastructure gap, not a
      // missing note: check the structure and let the run pass.
      console.warn(`Release notes: cannot diff against ${base}; checked structure only.`);
    }

    if (changed && needsNote(changed) && !notesChanged(changed)) {
      const messages = git(["log", "--format=%B", `${base}..HEAD`]);
      if (!hasSkipMarker(messages)) {
        problems.push(
          `This change touches code but adds no release note. Add one bullet per language to ` +
            `${UNRELEASED_DIR}/ (see ${RELEASES_DIR}/README.md), or put [skip notes] in the commit ` +
            `message when no user could notice the change.`,
        );
      }
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error::${problem}`);
    process.exit(1);
  }

  console.log("Release notes OK.");
}

if (process.argv[1]?.endsWith("check-release-notes.mjs")) main();
