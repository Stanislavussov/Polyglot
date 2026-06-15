import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const updateStatus = vi.fn();
  const list = vi.fn(() =>
    Promise.resolve({
      issues: [
        {
          id: 1,
          userId: 10,
          type: "bug",
          description: "Something is broken",
          status: "open",
          createdAt: new Date("2026-06-14T00:00:00Z"),
          updatedAt: new Date("2026-06-14T00:00:00Z"),
          user: {
            id: 10,
            telegramId: 12345,
            username: "polyglot_user",
          },
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    }),
  );

  return { list, updateStatus };
});

vi.mock("@polyglot/adapter-db", () => ({
  reportedIssueRepository: {
    list: mocks.list,
    updateStatus: mocks.updateStatus,
  },
}));

const { reportedIssueRoutes } = await import("./reported-issues.js");

async function buildApp() {
  const app = Fastify();
  app.decorateRequest("jwtVerify", async () => undefined);
  await app.register(reportedIssueRoutes);
  return app;
}

describe("reportedIssueRoutes", () => {
  beforeEach(() => {
    mocks.updateStatus.mockResolvedValue({
      id: 1,
      userId: 10,
      type: "bug",
      description: "Something is broken",
      status: "resolved",
      createdAt: new Date("2026-06-14T00:00:00Z"),
      updatedAt: new Date("2026-06-14T00:00:00Z"),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lists reported issues", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/reported-issues" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      issues: [{ id: 1, status: "open" }],
      total: 1,
      page: 1,
      limit: 20,
    });
    await app.close();
  });

  it("updates an issue status", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "PUT",
      url: "/reported-issues/1/status",
      payload: { status: "resolved" },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.updateStatus).toHaveBeenCalledWith(1, "resolved");
    expect(response.json()).toMatchObject({ id: 1, status: "resolved" });
    await app.close();
  });

  it("returns 404 when issue does not exist", async () => {
    mocks.updateStatus.mockResolvedValue(null);
    const app = await buildApp();

    const response = await app.inject({
      method: "PUT",
      url: "/reported-issues/999/status",
      payload: { status: "resolved" },
    });

    expect(response.statusCode).toBe(404);
    expect(mocks.updateStatus).toHaveBeenCalledWith(999, "resolved");
    await app.close();
  });

  it("returns 400 for invalid status values", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "PUT",
      url: "/reported-issues/1/status",
      payload: { status: "invalid" },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.updateStatus).not.toHaveBeenCalled();
    await app.close();
  });
});
