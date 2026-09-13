import { describe, expect, it } from "vitest";
// Straight from connection.ts rather than the package barrel: the barrel re-exports
// every repository and the whole schema, and pulling that in costs ~600ms — inside a
// test body it is charged against the 5s timeout and the test blinks under a cold
// transform cache.
import { closeDb, getDb } from "../connection.js";

describe("getDb", () => {
  it("should throw if DATABASE_URL is not set", async () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    try {
      // The connection is a module singleton: drop any client a previous caller left
      // behind, or getDb() returns it instead of re-reading the environment.
      await closeDb();

      expect(() => getDb()).toThrow("DATABASE_URL environment variable is not set");
    } finally {
      if (original !== undefined) {
        process.env.DATABASE_URL = original;
      }
    }
  });
});
