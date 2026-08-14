/**
 * Translation read order — real-DB integration tests.
 *
 * Two defects are pinned here.
 *
 * **RC-2 (regression).** The translation selects carried no `ORDER BY`, so row
 * order was plan-dependent and moved whenever a tuple was rewritten. The sharpest
 * case is `updateSrsState`: it writes `srs_due_date`, which is indexed
 * (`vt_srs_due_idx`), so the update is **not** HOT-eligible and the row
 * relocates. That fires on every SRS review, which is why a card that was never
 * edited still drifted over time. `updateTranslation` writes only non-indexed
 * columns and is HOT-eligible, so it is the weaker case and not the one asserted
 * here.
 *
 * **RC-1 (characterization, not a regression).** Postgres `jsonb` does not
 * preserve object key order. This passes both before and after the fix — it
 * documents *why* the bot session cannot carry language order, and it will fail
 * loudly if that behaviour ever changes.
 */
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../connection.js";
import { languageRepository } from "../repositories/language.repository.js";
import { userRepository } from "../repositories/user.repository.js";
import { vocabularyRepository } from "../repositories/vocabulary.repository.js";
import { uniqueTelegramId } from "../test-helpers/integration/id-factory.js";

async function langId(code: string): Promise<number> {
  const lang = await languageRepository.findByCode(code);
  if (!lang) throw new Error(`Expected seeded language '${code}' to exist on the migrated branch`);
  return lang.id;
}

async function freshUserId(): Promise<number> {
  const user = await userRepository.create({ telegramId: uniqueTelegramId(), username: "vocab-order-test" });
  return user.id;
}

/** Create an entry translated into three languages. */
async function seedEntry(userId: number, original: string) {
  const [en, de, es, cs] = await Promise.all([langId("en"), langId("de"), langId("es"), langId("cs")]);
  const entry = await vocabularyRepository.create(userId, {
    original,
    sourceLangId: en,
    inputType: "word",
    translations: [
      { targetLangId: de, text: "Haus" },
      { targetLangId: es, text: "casa" },
      { targetLangId: cs, text: "dům" },
    ],
  });
  return { entry, en, de, es, cs };
}

async function readOrder(entryId: number): Promise<number[]> {
  const found = await vocabularyRepository.findById(entryId);
  if (!found) throw new Error(`Entry ${entryId} disappeared`);
  return found.translations.map((t) => t.targetLangId);
}

describe("vocabulary translation read order", () => {
  it("is unchanged after an SRS review rewrites a translation row", async () => {
    const userId = await freshUserId();
    const { entry } = await seedEntry(userId, `srs-${uniqueTelegramId()}`);

    const before = await readOrder(entry.id);
    expect(before).toHaveLength(3);

    // The middle row: if order followed physical placement, rewriting this one
    // would move it to the end.
    const middle = entry.translations[1]!;
    await vocabularyRepository.updateSrsState(middle.id, {
      easeFactor: 2.6,
      interval: 3,
      dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      reviewCount: 1,
    });

    expect(await readOrder(entry.id)).toEqual(before);
  });

  it("is unchanged after the word is re-saved", async () => {
    const userId = await freshUserId();
    const original = `resave-${uniqueTelegramId()}`;
    const { entry, en, de, es, cs } = await seedEntry(userId, original);

    const before = await readOrder(entry.id);

    // Re-saving goes through ON CONFLICT DO UPDATE and rewrites every row.
    await vocabularyRepository.create(userId, {
      original,
      sourceLangId: en,
      inputType: "word",
      translations: [
        { targetLangId: cs, text: "dům" },
        { targetLangId: de, text: "Haus" },
        { targetLangId: es, text: "casa" },
      ],
    });

    expect(await readOrder(entry.id)).toEqual(before);
  });

  it("is unchanged after regeneration replaces every translation", async () => {
    const userId = await freshUserId();
    const { entry, de, es, cs } = await seedEntry(userId, `regen-${uniqueTelegramId()}`);

    const before = await readOrder(entry.id);

    // The dictionary regenerate path: deletes removed languages and upserts the
    // rest, so all three rows are rewritten in a different input order.
    await vocabularyRepository.updateAllTranslations(entry.id, [
      { targetLangId: es, text: "casa nueva" },
      { targetLangId: cs, text: "nový dům" },
      { targetLangId: de, text: "neues Haus" },
    ]);

    expect(await readOrder(entry.id)).toEqual(before);
  });

  it("returns the same order across repeated reads", async () => {
    const userId = await freshUserId();
    const { entry } = await seedEntry(userId, `repeat-${uniqueTelegramId()}`);

    const reads = await Promise.all([readOrder(entry.id), readOrder(entry.id), readOrder(entry.id)]);

    expect(reads[1]).toEqual(reads[0]);
    expect(reads[2]).toEqual(reads[0]);
  });
});

describe("jsonb key order (characterization)", () => {
  it("does not preserve object key order — it sorts by key length, then bytewise", async () => {
    const db = getDb();
    const rows = await db.execute<{ round_tripped: Record<string, number> }>(
      sql`SELECT '{"ru":1,"de":2,"cs":3,"en":4}'::jsonb AS round_tripped`,
    );

    const keys = Object.keys(rows[0]!.round_tripped);

    // Every ISO 639-1 code is two characters, so the length component ties and
    // the result is plain alphabetical. This is the whole reason a language-keyed
    // record cannot carry display order through the bot session — and the reason
    // ordering is derived at render time instead.
    expect(keys).toEqual(["cs", "de", "en", "ru"]);
    expect(keys).not.toEqual(["ru", "de", "cs", "en"]);
  });
});
