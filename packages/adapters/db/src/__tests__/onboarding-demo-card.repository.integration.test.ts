/**
 * Onboarding demo cards — real-DB integration tests (Task 71 lane, Task 72 slice 4).
 *
 * Runs against a real, migrated Postgres. The two guarantees that cannot be
 * proven with a mocked query builder are proven here: the `is_active` filter is
 * actually applied by the database, and the unique index really collapses a
 * repeated `upsert` into one row.
 *
 * `source_lang` / `native_lang` are free-text columns with no foreign key, so
 * every test scopes its rows to its OWN synthetic language pair (derived from
 * the collision-safe id factory). Parallel workers therefore never see, order,
 * or overwrite each other's rows, and no cleanup is needed between tests.
 */
import type { TranslateOutput } from "@polyglot/core";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "../connection.js";
import { onboardingDemoCardRepository } from "../repositories/onboarding-demo-card.repository.js";
import { onboardingDemoCards } from "../schema.js";
import { uniqueTelegramId } from "../test-helpers/integration/id-factory.js";

/** A language pair no other test can be using. */
function freshPair(): { sourceLang: string; nativeLang: string } {
  const id = uniqueTelegramId();
  return { sourceLang: `zs${id}`, nativeLang: `zn${id}` };
}

function payloadFor(headword: string, meaning: string): TranslateOutput {
  return {
    original: headword,
    sourceLang: "de",
    nativeMeaning: meaning,
    nativeSynonyms: [],
    translations: {},
  };
}

describe("onboardingDemoCardRepository (integration)", () => {
  it("serves reviewed cards and hides unreviewed ones from both read paths", async () => {
    const { sourceLang, nativeLang } = freshPair();
    const db = getDb();

    await db.insert(onboardingDemoCards).values([
      {
        sourceLang,
        nativeLang,
        headword: "reviewed",
        payload: payloadFor("reviewed", "ok to show"),
        sortOrder: 0,
        isActive: true,
      },
      {
        sourceLang,
        nativeLang,
        headword: "unreviewed",
        payload: payloadFor("unreviewed", "must never be shown"),
        sortOrder: 1,
        isActive: false,
      },
    ]);

    const active = await onboardingDemoCardRepository.findActive(sourceLang, nativeLang);
    expect(active.map((card) => card.headword)).toEqual(["reviewed"]);

    await expect(onboardingDemoCardRepository.findOne(sourceLang, nativeLang, "reviewed")).resolves.toMatchObject({
      headword: "reviewed",
      isActive: true,
    });
    await expect(onboardingDemoCardRepository.findOne(sourceLang, nativeLang, "unreviewed")).resolves.toBeNull();
  });

  it("orders reviewed cards by sort order, then by id", async () => {
    const { sourceLang, nativeLang } = freshPair();
    const db = getDb();

    // "second" is inserted first but carries the higher sort order; "tie-a" and
    // "tie-b" share a sort order so only insertion order (id) can break it.
    await db.insert(onboardingDemoCards).values(
      ["second", "first", "tie-a", "tie-b"].map((headword, index) => ({
        sourceLang,
        nativeLang,
        headword,
        payload: payloadFor(headword, headword),
        sortOrder: index === 0 ? 5 : index === 1 ? 1 : 9,
        isActive: true,
      })),
    );

    const active = await onboardingDemoCardRepository.findActive(sourceLang, nativeLang);
    expect(active.map((card) => card.headword)).toEqual(["first", "second", "tie-a", "tie-b"]);
  });

  it("lists unreviewed cards with their payloads for review — the serving path hides them", async () => {
    const { sourceLang, nativeLang } = freshPair();
    const db = getDb();

    await db.insert(onboardingDemoCards).values(
      ["alpha", "beta", "gamma"].map((headword, index) => ({
        sourceLang,
        nativeLang,
        headword,
        payload: payloadFor(headword, `meaning of ${headword}`),
        sortOrder: index,
        isActive: headword === "alpha",
      })),
    );

    const all = await onboardingDemoCardRepository.list({ page: 1, limit: 20, sourceLang, nativeLang });
    expect(all.cards.map((card) => card.headword)).toEqual(["alpha", "beta", "gamma"]);
    expect(all.total).toBe(3);
    expect(all.cards[1]?.payload.nativeMeaning).toBe("meaning of beta");
    // Whole-table counts, so other rows may exist — but the review backlog can
    // never be negative and the filtered page can never exceed the cache.
    expect(all.counts.cached).toBeGreaterThanOrEqual(all.counts.active);
    expect(all.counts.cached).toBeGreaterThanOrEqual(all.total);

    const pending = await onboardingDemoCardRepository.list({
      page: 1,
      limit: 20,
      sourceLang,
      nativeLang,
      isActive: false,
    });
    expect(pending.cards.map((card) => card.headword)).toEqual(["beta", "gamma"]);
    expect(pending.total).toBe(2);
  });

  it("paginates and searches the review listing by headword", async () => {
    const { sourceLang, nativeLang } = freshPair();
    const db = getDb();

    await db.insert(onboardingDemoCards).values(
      ["one", "two", "three"].map((headword, index) => ({
        sourceLang,
        nativeLang,
        headword,
        payload: payloadFor(headword, headword),
        sortOrder: index,
      })),
    );

    const secondPage = await onboardingDemoCardRepository.list({ page: 2, limit: 2, sourceLang, nativeLang });
    expect(secondPage.cards.map((card) => card.headword)).toEqual(["three"]);
    expect(secondPage.total).toBe(3);

    const found = await onboardingDemoCardRepository.list({
      page: 1,
      limit: 20,
      sourceLang,
      nativeLang,
      search: "hre",
    });
    expect(found.cards.map((card) => card.headword)).toEqual(["three"]);
    expect(found.total).toBe(1);
  });

  it("publishes and un-publishes a cached card through the review step", async () => {
    const { sourceLang, nativeLang } = freshPair();

    await onboardingDemoCardRepository.upsert({
      sourceLang,
      nativeLang,
      headword: "doch",
      payload: payloadFor("doch", "pending review"),
    });

    expect(await onboardingDemoCardRepository.findActive(sourceLang, nativeLang)).toEqual([]);

    await expect(onboardingDemoCardRepository.setActive(sourceLang, nativeLang, "doch", true)).resolves.toBe(true);
    expect((await onboardingDemoCardRepository.findActive(sourceLang, nativeLang)).map((c) => c.headword)).toEqual([
      "doch",
    ]);

    await expect(onboardingDemoCardRepository.setActive(sourceLang, nativeLang, "doch", false)).resolves.toBe(true);
    expect(await onboardingDemoCardRepository.findActive(sourceLang, nativeLang)).toEqual([]);

    await expect(onboardingDemoCardRepository.setActive(sourceLang, nativeLang, "missing", true)).resolves.toBe(false);
  });

  it("keeps one row per triple when the warm-up runs twice, holding the newest payload", async () => {
    const { sourceLang, nativeLang } = freshPair();
    const db = getDb();

    await onboardingDemoCardRepository.upsert({
      sourceLang,
      nativeLang,
      headword: "doch",
      payload: payloadFor("doch", "first pass"),
      sortOrder: 0,
    });
    await onboardingDemoCardRepository.upsert({
      sourceLang,
      nativeLang,
      headword: "doch",
      payload: payloadFor("doch", "second pass"),
      sortOrder: 2,
    });

    const rows = await db
      .select()
      .from(onboardingDemoCards)
      .where(and(eq(onboardingDemoCards.sourceLang, sourceLang), eq(onboardingDemoCards.nativeLang, nativeLang)));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload.nativeMeaning).toBe("second pass");
    expect(rows[0]?.sortOrder).toBe(2);
  });

  it("leaves a reviewed card published when the warm-up regenerates it", async () => {
    const { sourceLang, nativeLang } = freshPair();
    const db = getDb();

    await db.insert(onboardingDemoCards).values({
      sourceLang,
      nativeLang,
      headword: "doch",
      payload: payloadFor("doch", "reviewed payload"),
      sortOrder: 0,
      isActive: true,
    });

    await onboardingDemoCardRepository.upsert({
      sourceLang,
      nativeLang,
      headword: "doch",
      payload: payloadFor("doch", "regenerated payload"),
    });

    const served = await onboardingDemoCardRepository.findOne(sourceLang, nativeLang, "doch");
    expect(served?.isActive).toBe(true);
    expect(served?.payload.nativeMeaning).toBe("regenerated payload");
  });
});
