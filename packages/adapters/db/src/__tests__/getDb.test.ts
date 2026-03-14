import { describe, it, expect } from "vitest";

describe("getDb", () => {
  it("should throw if DATABASE_URL is not set", async () => {
    // Ensure DATABASE_URL is not set for this test
    const original = process.env["DATABASE_URL"];
    delete process.env["DATABASE_URL"];

    try {
      // Dynamic import to avoid module-level side effects
      // Reset module cache by importing the factory function fresh
      const { getDb } = await import("../index.js");

      // Reset singleton state — we need a fresh call
      const { closeDb } = await import("../index.js");
      await closeDb();

      expect(() => getDb()).toThrow("DATABASE_URL environment variable is not set");
    } finally {
      if (original !== undefined) {
        process.env["DATABASE_URL"] = original;
      }
    }
  });
});
