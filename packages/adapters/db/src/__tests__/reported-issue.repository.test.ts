import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock Drizzle query builder ──────────────────────────────────

let selectResultQueue: unknown[][] = [];
let insertResultQueue: unknown[][] = [];

function makeThenable(resultFn: () => unknown[]) {
  const promise = Promise.resolve().then(() => resultFn());
  return {
    // biome-ignore lint/suspicious/noThenProperty: mimicking Drizzle's thenable query builder for tests
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    limit: vi.fn(() => makeThenable(resultFn)),
    orderBy: vi.fn(() => makeThenable(resultFn)),
  };
}

const selectWhereFn = vi.fn(() => {
  const result = selectResultQueue.shift() ?? [];
  return makeThenable(() => result);
});

const selectFromFn = vi.fn(() => ({
  where: selectWhereFn,
  orderBy: vi.fn(() => {
    const result = selectResultQueue.shift() ?? [];
    return makeThenable(() => result);
  }),
}));

const selectFn = vi.fn(() => ({ from: selectFromFn }));

const insertReturningFn = vi.fn(() => {
  const result = insertResultQueue.shift() ?? [];
  return Promise.resolve(result);
});

const insertValuesFn = vi.fn((_values: unknown) => ({ returning: insertReturningFn }));
const insertFn = vi.fn(() => ({ values: insertValuesFn }));

const updateReturningFn = vi.fn(() => {
  const result = insertResultQueue.shift() ?? [];
  return Promise.resolve(result);
});

const updateSetFn = vi.fn(() => ({ where: vi.fn(() => ({ returning: updateReturningFn })) }));
const updateFn = vi.fn(() => ({ set: updateSetFn }));

const mockDb = {
  select: selectFn,
  insert: insertFn,
  update: updateFn,
};

vi.mock("../connection.js", () => ({ getDb: () => mockDb }));

// Import after mock is set up — relative path like other db tests
const { reportedIssueRepository } = await import("../repositories/reported-issue.repository.js");

describe("reportedIssueRepository", () => {
  beforeEach(() => {
    selectResultQueue = [];
    insertResultQueue = [];
    vi.resetAllMocks();
  });

  describe("create", () => {
    it("inserts a new reported issue and returns it", async () => {
      const mockIssue = {
        id: 1,
        userId: 10,
        type: "bug" as const,
        description: "Something is broken",
        status: "open" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      insertResultQueue.push([mockIssue]);

      const result = await reportedIssueRepository.create(10, "bug", "Something is broken");

      expect(result).toEqual(mockIssue);
      expect(insertFn).toHaveBeenCalledOnce();
    });
  });

  describe("findByUser", () => {
    it("returns all issues for a user ordered by createdAt DESC", async () => {
      const mockIssues = [
        {
          id: 2,
          userId: 10,
          type: "suggestion",
          description: "Add feature X",
          status: "open",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 1,
          userId: 10,
          type: "bug",
          description: "Fix Y",
          status: "resolved",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      selectResultQueue.push(mockIssues);

      const result = await reportedIssueRepository.findByUser(10);

      expect(result).toEqual(mockIssues);
    });
  });

  describe("findByStatus", () => {
    it("returns all issues with the given status for admin query", async () => {
      const mockIssues = [
        {
          id: 1,
          userId: 10,
          type: "bug",
          description: "Fix Y",
          status: "open",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      selectResultQueue.push(mockIssues);

      const result = await reportedIssueRepository.findByStatus("open");

      expect(result).toEqual(mockIssues);
    });
  });

  describe("updateStatus", () => {
    it("updates the status and returns the updated issue", async () => {
      const mockUpdated = {
        id: 1,
        userId: 10,
        type: "bug" as const,
        description: "Fix Y",
        status: "resolved" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      insertResultQueue.push([mockUpdated]);

      const result = await reportedIssueRepository.updateStatus(1, "resolved");

      expect(result).toEqual(mockUpdated);
    });

    it("returns null when issue does not exist", async () => {
      insertResultQueue.push([]);

      const result = await reportedIssueRepository.updateStatus(999, "resolved");

      expect(result).toBeNull();
    });
  });
});
