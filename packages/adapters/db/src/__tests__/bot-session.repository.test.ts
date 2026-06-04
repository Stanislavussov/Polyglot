import { beforeEach, describe, expect, it, vi } from "vitest";

const limitFn = vi.fn<() => Promise<unknown[]>>();
const whereFn = vi.fn<() => Promise<void>>();
const onConflictDoUpdateFn = vi.fn<() => Promise<void>>();
const valuesFn = vi.fn(() => ({ onConflictDoUpdate: onConflictDoUpdateFn }));

const mockDb = {
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: limitFn,
      })),
    })),
  })),
  insert: vi.fn(() => ({
    values: valuesFn,
  })),
  delete: vi.fn(() => ({
    where: whereFn,
  })),
};

vi.mock("../connection.js", () => ({
  getDb: () => mockDb,
}));

const { botSessionRepository } = await import("../repositories/bot-session.repository.js");

beforeEach(() => {
  vi.clearAllMocks();
  limitFn.mockResolvedValue([]);
  whereFn.mockResolvedValue(undefined);
  onConflictDoUpdateFn.mockResolvedValue(undefined);
});

describe("botSessionRepository", () => {
  it("returns a stored session by key", async () => {
    const row = {
      key: "123",
      data: { activeMode: "translate" },
      version: 1,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-02"),
    };
    limitFn.mockResolvedValueOnce([row]);

    await expect(botSessionRepository.get("123")).resolves.toEqual(row);
  });

  it("returns null when session is missing", async () => {
    await expect(botSessionRepository.get("missing")).resolves.toBeNull();
  });

  it("upserts a session row", async () => {
    const data = { activeMode: "translate" };

    await botSessionRepository.upsert("123", data);

    expect(mockDb.insert).toHaveBeenCalledOnce();
    expect(valuesFn).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "123",
        data,
        version: 1,
      }),
    );
    expect(onConflictDoUpdateFn).toHaveBeenCalledOnce();
  });

  it("deletes a session row", async () => {
    await botSessionRepository.delete("123");

    expect(mockDb.delete).toHaveBeenCalledOnce();
    expect(whereFn).toHaveBeenCalledOnce();
  });
});
