import { describe, expect, it } from "vitest";
import { hasSkipMarker, needsNote, notesChanged, parseBullets, validateQueue } from "./check-release-notes.mjs";

describe("needsNote", () => {
  it("asks for a note when code changes", () => {
    expect(needsNote(["apps/bot/src/scenes/settings.scene.ts"])).toBe(true);
    expect(needsNote(["packages/core/src/modules/i18n/locales/ru.json"])).toBe(true);
    expect(needsNote([".github/workflows/deploy.yml"])).toBe(true);
    expect(needsNote(["package.json"])).toBe(true);
  });

  it("does not ask for a note when nothing a user could notice changed", () => {
    expect(needsNote(["@docs/agents/deployment.md"])).toBe(false);
    expect(needsNote(["README.md"])).toBe(false);
    expect(needsNote([".claude/skills/bot-testing/SKILL.md"])).toBe(false);
    expect(needsNote(["apps/bot/src/release-notes.test.ts"])).toBe(false);
    expect(needsNote(["packages/adapters/db/src/__tests__/users.integration.test.ts"])).toBe(false);
  });
});

describe("notesChanged", () => {
  it("recognises a note added to the queue", () => {
    expect(notesChanged(["@docs/releases/unreleased/ru.md"])).toBe(true);
    expect(notesChanged(["@docs/releases/README.md"])).toBe(false);
  });
});

describe("hasSkipMarker", () => {
  it("reads the escape hatch out of the commit messages", () => {
    expect(hasSkipMarker("refactor(bot): extract helper\n\n[skip notes]")).toBe(true);
    expect(hasSkipMarker("feat(bot): add a thing")).toBe(false);
  });
});

describe("validateQueue", () => {
  const files = { "en.md": "- First change.\n- Second change.", "ru.md": "- Первое.\n- Второе." };
  const read = (source) => (name) => source[name] ?? null;

  it("passes when every required language matches the English spine", () => {
    expect(validateQueue(["en", "ru"], read(files))).toEqual([]);
  });

  it("fails an empty English spine", () => {
    expect(validateQueue(["en", "ru"], read({ "en.md": "# Unreleased — en" }))).toHaveLength(1);
  });

  it("fails a missing required language", () => {
    const problems = validateQueue(["en", "ru"], read({ "en.md": files["en.md"] }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("ru.md is missing");
  });

  it("fails a translation that is out of step with English", () => {
    const problems = validateQueue(["en", "ru"], read({ ...files, "ru.md": "- Первое." }));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("has 1 note(s), en.md has 2");
  });
});

describe("parseBullets", () => {
  it("matches the bot's parser: one bullet is one note", () => {
    expect(parseBullets("# Title\n\nProse.\n\n- One.\n- Two.\n")).toEqual(["One.", "Two."]);
  });
});
