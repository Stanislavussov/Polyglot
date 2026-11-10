import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The web app must not import runtime code from packages/core, so it takes only the
// translated strings: the locale JSON files are plain data, read once at build time.
const LOCALES_DIR = fileURLToPath(new URL("../../../packages/core/src/modules/i18n/locales", import.meta.url));
const OUT_DIR = fileURLToPath(new URL("../src/i18n/generated", import.meta.url));
const WEB_PREFIX = "web.";

type Messages = Record<string, string>;

function readLocale(file: string): Messages {
  return JSON.parse(readFileSync(join(LOCALES_DIR, file), "utf8")) as Messages;
}

function webKeys(messages: Messages): Messages {
  return Object.fromEntries(Object.entries(messages).filter(([key]) => key.startsWith(WEB_PREFIX)));
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const english = webKeys(readLocale("en.json"));
const files = readdirSync(LOCALES_DIR).filter((file) => file.endsWith(".json"));

for (const file of files) {
  const messages = webKeys(readLocale(file));
  // A silent English fallback would ship an untranslated screen, so a gap fails the build.
  const missing = Object.keys(english).filter((key) => !(key in messages));
  if (missing.length > 0) {
    throw new Error(`${file} is missing web keys: ${missing.join(", ")}`);
  }
  writeFileSync(join(OUT_DIR, file), `${JSON.stringify(messages, null, 2)}\n`);
}

process.stdout.write(`i18n: wrote ${files.length} locales, ${Object.keys(english).length} web keys each\n`);
