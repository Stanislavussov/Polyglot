import { describe, expect, it, vi } from "vitest";
import { logDelivery } from "./delivery-log.js";

const entry = { userId: 1, kind: "word_card", text: "<b>Haus</b>", parseMode: "HTML" } as const;

describe("logDelivery", () => {
  it("hands the delivered message to the journal", async () => {
    const record = vi.fn(async () => {});

    await logDelivery({ record }, entry);

    expect(record).toHaveBeenCalledWith(entry);
  });

  it("resolves when the journal write fails, so the caller never re-sends a delivered message", async () => {
    const record = vi.fn(async () => {
      throw new Error("connection terminated");
    });

    await expect(logDelivery({ record }, entry)).resolves.toBeUndefined();
  });
});
