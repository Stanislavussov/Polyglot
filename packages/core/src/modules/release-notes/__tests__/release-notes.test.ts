import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAnnouncementText,
  noteId,
  parseNotes,
  pickNotesLang,
  readNotes,
  readNotesForReader,
  readRequiredLanguages,
  readTranslatedNotes,
  TELEGRAM_MAX_MESSAGE_CHARS,
  textForReader,
} from "../release-notes.js";

function notesDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "release-notes-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf8");
  }
  return dir;
}

describe("parseNotes", () => {
  it("takes one bullet as one note and ignores the file's prose", () => {
    expect(
      parseNotes(`# Unreleased — en

Notes for the next release.

- First change.
- Second change.
`),
    ).toEqual(["First change.", "Second change."]);
  });

  it("ignores empty bullets", () => {
    expect(parseNotes("- \n- Real change.")).toEqual(["Real change."]);
  });
});

describe("noteId", () => {
  it("follows the English text, not the position", () => {
    const first = noteId("First change.");
    const second = noteId("Second change.");

    expect(first).not.toBe(second);
    expect(noteId("Second change.")).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("readNotes", () => {
  it("pairs a translation with the English spine by position", () => {
    const dir = notesDir({
      "en.md": "- First change.\n- Second change.",
      "ru.md": "- Первое изменение.\n- Второе изменение.",
    });

    expect(readNotes(dir, "ru")).toEqual([
      { id: noteId("First change."), text: "Первое изменение." },
      { id: noteId("Second change."), text: "Второе изменение." },
    ]);
  });

  it("drops a translation that is out of step rather than pairing the wrong lines", () => {
    const dir = notesDir({
      "en.md": "- First change.\n- Second change.",
      "ru.md": "- Первое изменение.",
    });

    expect(readNotes(dir, "ru")).toEqual([
      { id: noteId("First change."), text: "First change." },
      { id: noteId("Second change."), text: "Second change." },
    ]);
  });

  it("falls back to English for a language with no file", () => {
    const dir = notesDir({ "en.md": "- First change." });

    expect(readNotes(dir, "de")).toEqual([{ id: noteId("First change."), text: "First change." }]);
  });

  it("reads nothing when the queue is empty", () => {
    expect(readNotes(notesDir({ "en.md": "# Unreleased — en\n" }), "ru")).toEqual([]);
  });
});

describe("readNotesForReader", () => {
  const dir = notesDir({
    "en.md": "- First change.",
    "ru.md": "- Первое изменение.",
  });

  it("prefers the interface language", () => {
    expect(readNotesForReader(dir, ["ru", "en"])[0]?.text).toBe("Первое изменение.");
    expect(pickNotesLang(dir, ["ru", "en"])).toBe("ru");
  });

  it("falls back to the native language when the interface language is untranslated", () => {
    expect(readNotesForReader(dir, ["de", "ru"])[0]?.text).toBe("Первое изменение.");
    expect(pickNotesLang(dir, ["de", "ru"])).toBe("ru");
  });

  it("falls back to English when neither is translated", () => {
    expect(readNotesForReader(dir, ["de", "fr"])[0]?.text).toBe("First change.");
    expect(pickNotesLang(dir, ["de", "fr"])).toBe("en");
  });
});

describe("readTranslatedNotes", () => {
  it("carries every language of a note in one row, keyed by language", () => {
    const dir = notesDir({
      "en.md": "- First change.\n- Second change.",
      "ru.md": "- Первое изменение.\n- Второе изменение.",
    });

    expect(readTranslatedNotes(dir)).toEqual([
      { id: noteId("First change."), texts: { en: "First change.", ru: "Первое изменение." } },
      { id: noteId("Second change."), texts: { en: "Second change.", ru: "Второе изменение." } },
    ]);
  });

  it("leaves out a language out of step with English instead of pairing it wrongly", () => {
    const dir = notesDir({
      "en.md": "- First change.\n- Second change.",
      "ru.md": "- Первое изменение.",
      "de.md": "- Erste Änderung.\n- Zweite Änderung.",
    });

    const notes = readTranslatedNotes(dir);

    expect(Object.keys(notes[0]?.texts ?? {}).sort()).toEqual(["de", "en"]);
  });
});

describe("textForReader", () => {
  const note = { id: "a", texts: { en: "First change.", ru: "Первое изменение." } };

  it("answers in the first language the note was written in", () => {
    expect(textForReader(note, ["ru", "en"])).toBe("Первое изменение.");
    expect(textForReader(note, ["de", "ru"])).toBe("Первое изменение.");
    expect(textForReader(note, ["de", "fr"])).toBe("First change.");
  });
});

describe("readRequiredLanguages", () => {
  it("reads the enforced list", () => {
    const dir = notesDir({ "languages.json": JSON.stringify({ required: ["en", "ru"] }) });

    expect(readRequiredLanguages(dir)).toEqual(["en", "ru"]);
  });

  it("falls back to English rather than failing when the list is missing or malformed", () => {
    expect(readRequiredLanguages(notesDir({}))).toEqual(["en"]);
    expect(readRequiredLanguages(notesDir({ "languages.json": "{ nope" }))).toEqual(["en"]);
  });
});

describe("buildAnnouncementText", () => {
  it("renders the header and one bullet per note", () => {
    const notes = [
      { id: "a", text: "First change." },
      { id: "b", text: "Second change." },
    ];

    const { text, included } = buildAnnouncementText("What's new", notes);

    expect(text).toBe("<b>What's new</b>\n\n• First change.\n• Second change.");
    expect(included).toEqual(notes);
  });

  it("escapes HTML in the note and the header", () => {
    const { text } = buildAnnouncementText("What's new", [{ id: "a", text: "<b> & </b>" }]);

    expect(text).toContain("&lt;b&gt; &amp; &lt;/b&gt;");
  });

  it("reports only the notes that fit, so the rest stay pending", () => {
    const long = "x".repeat(2000);
    const notes = [
      { id: "a", text: long },
      { id: "b", text: long },
      { id: "c", text: long },
    ];

    const { text, included } = buildAnnouncementText("What's new", notes);

    expect(text.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_CHARS);
    expect(included.map((note) => note.id)).toEqual(["a", "b"]);
  });

  it("truncates a single oversized note instead of blocking every later send", () => {
    // "&" escapes to the 5-char entity "&amp;", so a naive slice at the budget
    // is very likely to land inside one.
    const { text, included } = buildAnnouncementText("What's new", [{ id: "a", text: "&".repeat(5000) }]);

    expect(text.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_CHARS);
    expect(included.map((note) => note.id)).toEqual(["a"]);
    expect(text.endsWith("…")).toBe(true);
    expect(text.slice(0, -1)).not.toMatch(/&[a-z]*$/);
  });
});
