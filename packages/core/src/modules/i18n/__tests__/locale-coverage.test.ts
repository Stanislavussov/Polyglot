import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const LOCALES_DIR = fileURLToPath(new URL("../locales", import.meta.url));

function readLocale(file: string): Record<string, string> {
  return JSON.parse(readFileSync(join(LOCALES_DIR, file), "utf8"));
}

const english = Object.keys(readLocale("en.json"));
const locales = readdirSync(LOCALES_DIR).filter((file) => file.endsWith(".json") && file !== "en.json");

describe("locale coverage", () => {
  it("ships all 11 interface languages", () => {
    expect(locales).toHaveLength(10);
  });

  it.each(locales)("%s has every key that en.json has", (file) => {
    const keys = new Set(Object.keys(readLocale(file)));
    expect(english.filter((key) => !keys.has(key))).toEqual([]);
  });

  it.each(locales)("%s keeps every {placeholder} of the English text", (file) => {
    const en = readLocale("en.json");
    const messages = readLocale(file);
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    const drifted = english.filter(
      (key) => key in messages && JSON.stringify(placeholders(messages[key])) !== JSON.stringify(placeholders(en[key])),
    );
    expect(drifted).toEqual([]);
  });
});
