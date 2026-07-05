/**
 * Identity repository round-trip (Fable T24/A1).
 *
 * Drives the real adapter against a stateful fake DB that models the
 * `(channel, external_id)` unique constraint, so `linkIdentity` → `resolveUserId`
 * / `findExternalId` exercise genuine round-trip semantics (including ON CONFLICT
 * DO NOTHING idempotency), not just call-shape assertions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { identities } from "../schema.js";

interface IdentityRow {
  userId: number;
  channel: string;
  externalId: string;
}

let store: IdentityRow[] = [];

// SELECT returns the current store; tests keep a single relevant identity so the
// (unmodeled) WHERE filter is a no-op — the adapter's own projection/limit apply.
function selectChain(): unknown {
  const self: Record<string, unknown> = {};
  self.from = vi.fn(() => self);
  self.where = vi.fn(() => self);
  self.limit = vi.fn(() => self);
  self.then = (resolve: (v: unknown) => void) => Promise.resolve(store).then(resolve);
  return self;
}

// INSERT models the unique constraint: onConflictDoNothing skips a duplicate
// (channel, externalId), exactly as the real ON CONFLICT DO NOTHING would.
function insertChain(): unknown {
  const self: Record<string, unknown> = {};
  let pending: IdentityRow | null = null;
  self.values = vi.fn((v: IdentityRow) => {
    pending = v;
    return self;
  });
  self.onConflictDoNothing = vi.fn(() => {
    if (pending && !store.some((r) => r.channel === pending?.channel && r.externalId === pending?.externalId)) {
      store.push(pending);
    }
    return self;
  });
  self.then = (resolve: (v: unknown) => void) => Promise.resolve(undefined).then(resolve);
  return self;
}

const mockDb = {
  select: vi.fn(() => selectChain()),
  insert: vi.fn(() => insertChain()),
};

vi.mock("../connection.js", () => ({
  getDb: () => mockDb,
}));

const { identityRepository } = await import("../repositories/identity.repository.js");

beforeEach(() => {
  store = [];
  vi.clearAllMocks();
  mockDb.select.mockImplementation(() => selectChain());
  mockDb.insert.mockImplementation(() => insertChain());
});

describe("identityRepository round-trip", () => {
  it("resolves the userId a linked identity was created with", async () => {
    await identityRepository.linkIdentity(42, "telegram", "123456");

    const userId = await identityRepository.resolveUserId("telegram", "123456");

    expect(userId).toBe(42);
  });

  it("returns null for an unknown identity", async () => {
    const userId = await identityRepository.resolveUserId("telegram", "999");

    expect(userId).toBeNull();
  });

  it("is idempotent — re-linking the same identity does not duplicate the row", async () => {
    await identityRepository.linkIdentity(42, "telegram", "123456");
    await identityRepository.linkIdentity(42, "telegram", "123456");

    expect(store).toHaveLength(1);
    await expect(identityRepository.resolveUserId("telegram", "123456")).resolves.toBe(42);
  });

  it("links idempotently via ON CONFLICT DO NOTHING on the (channel, externalId) unique", async () => {
    await identityRepository.linkIdentity(7, "telegram", "555");

    expect(mockDb.insert).toHaveBeenCalledWith(identities);
    const insertResult = mockDb.insert.mock.results[0]?.value as { onConflictDoNothing: ReturnType<typeof vi.fn> };
    expect(insertResult.onConflictDoNothing).toHaveBeenCalledWith({
      target: [identities.channel, identities.externalId],
    });
  });

  describe("notification send resolution (userId → externalId)", () => {
    it("resolves the channel externalId a notification send should deliver to", async () => {
      await identityRepository.linkIdentity(42, "telegram", "123456");

      const externalId = await identityRepository.findExternalId(42, "telegram");

      expect(externalId).toBe("123456");
    });

    it("returns null when the user has no identity for the channel", async () => {
      const externalId = await identityRepository.findExternalId(42, "telegram");

      expect(externalId).toBeNull();
    });
  });
});
