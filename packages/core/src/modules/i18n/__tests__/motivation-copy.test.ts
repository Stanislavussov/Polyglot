import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const localesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "locales");

const localeFiles = readdirSync(localesDir)
  .filter((file) => file.endsWith(".json"))
  .sort();

const MOTIVATION_KEY = /^(progress|praise|recovery|weeklyProof)/;
const NUMERIC_PLACEHOLDER = /\{(count|mature|reviews)\}/gu;
const RECOVERY_KEYS = ["recoveryLine", "recoveryDue"];

const motivationEntries = (file: string): [string, string][] => {
  const dict = JSON.parse(readFileSync(join(localesDir, file), "utf8")) as Record<string, string>;
  return Object.entries(dict).filter(([key]) => MOTIVATION_KEY.test(key));
};

describe("motivation copy — structural rules across every locale", () => {
  it("covers all 11 interface locales", () => {
    expect(localeFiles).toHaveLength(11);
  });

  for (const file of localeFiles) {
    describe(file, () => {
      const entries = motivationEntries(file);

      it("has motivation keys to check", () => {
        expect(entries.length).toBeGreaterThan(0);
      });

      it("writes every number as a labelled value, never gluing a noun to it", () => {
        for (const [key, value] of entries) {
          for (const match of value.matchAll(NUMERIC_PLACEHOLDER)) {
            const before = value.slice(0, match.index);
            const after = value.slice(match.index + match[0].length);
            expect(before, `${file} → ${key}: ${value}`).toMatch(/: $/u);
            expect(after, `${file} → ${key}: ${value}`).not.toMatch(/^\p{L}/u);
          }
        }
      });

      it("never leaks the raw momentum score", () => {
        for (const [key, value] of entries) {
          expect(value, `${file} → ${key}`).not.toContain("{score}");
        }
      });

      it("never names the length of the pause in the recovery copy", () => {
        for (const [key, value] of entries) {
          if (!RECOVERY_KEYS.includes(key)) continue;
          expect(value, `${file} → ${key}`).not.toMatch(/\d/u);
        }
      });
    });
  }
});
