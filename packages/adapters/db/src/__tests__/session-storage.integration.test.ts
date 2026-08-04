/**
 * Bot-session storage — real-DB integration tests (Task 71, Phase 3).
 *
 * Exercises `botSessionRepository` (the Postgres session store) against a real,
 * migrated branch. Every test uses a unique session key and only touches that
 * key. No shared fixtures, no cleanup between tests, no unscoped mutation.
 *
 * The grammY `StorageAdapter` wrapper (`createPostgresSessionStorage`) and the
 * `setTranslationEntry` eviction algorithm live in `apps/bot` (a higher layer this
 * db-package test must not import); they are covered end-to-end in the bot lane
 * (translation-map.helper.test.ts for the pure algorithm, and the Phase 5
 * callback-regression e2e for eviction over the real store). Here we prove the
 * repository contract and that a nested translation-map payload round-trips
 * through Postgres `jsonb` without loss — the persistence guarantee the eviction
 * fix (regression 1e6407c) relies on.
 */
import { describe, expect, it } from "vitest";
import { botSessionRepository } from "../repositories/bot-session.repository.js";
import { uniqueTelegramId } from "../test-helpers/integration/id-factory.js";

function uniqueKey(): string {
  return `session:${uniqueTelegramId()}`;
}

describe("botSessionRepository (integration)", () => {
  it("returns null for a missing key", async () => {
    expect(await botSessionRepository.get(uniqueKey())).toBeNull();
  });

  it("round-trips a written value and stamps version + timestamps", async () => {
    const key = uniqueKey();

    await botSessionRepository.upsert(key, { activeMode: "translate" });
    const row = await botSessionRepository.get(key);

    expect(row).not.toBeNull();
    expect(row?.key).toBe(key);
    expect(row?.data).toEqual({ activeMode: "translate" });
    expect(row?.version).toBe(1);
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it("overwrites the stored data on a second upsert of the same key", async () => {
    const key = uniqueKey();

    await botSessionRepository.upsert(key, { activeMode: "translate" });
    await botSessionRepository.upsert(key, { activeMode: "mentor" });

    const row = await botSessionRepository.get(key);
    expect(row?.data).toEqual({ activeMode: "mentor" });
  });

  it("removes the row on delete", async () => {
    const key = uniqueKey();

    await botSessionRepository.upsert(key, { activeMode: "translate" });
    await botSessionRepository.delete(key);

    expect(await botSessionRepository.get(key)).toBeNull();
  });

  it("round-trips a nested translation-map payload through jsonb without loss", async () => {
    const key = uniqueKey();
    // Shape mirrors SessionData.translationMap: keyed by message id, each entry
    // carrying the monotonic `addedAt` stamp the eviction fix depends on. The most
    // recently added entry (highest addedAt) must survive intact.
    const payload = {
      activeMode: "translate",
      translationMap: {
        "100": { output: { original: "old", sourceLang: "en" }, inputType: "word", addedAt: 1 },
        "101": { output: { original: "recent", sourceLang: "en" }, inputType: "word", addedAt: 2 },
      },
    };

    await botSessionRepository.upsert(key, payload);
    const row = await botSessionRepository.get(key);

    expect(row?.data).toEqual(payload);
  });
});
