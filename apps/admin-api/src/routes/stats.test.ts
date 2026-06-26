import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const getUserRequestCountsByDay = vi.fn(() =>
    Promise.resolve([
      {
        userId: 123,
        username: "alice",
        telegramId: 12345678,
        subscriptionPlan: "free",
        day: "2026-06-22",
        count: 5,
      },
      {
        userId: 123,
        username: "alice",
        telegramId: 12345678,
        subscriptionPlan: "free",
        day: "2026-06-21",
        count: 3,
      },
    ]),
  );

  return { getUserRequestCountsByDay };
});

vi.mock("@polyglot/adapter-db", () => ({
  userRequestCountRepository: {
    getUserRequestCountsByDay: mocks.getUserRequestCountsByDay,
  },
}));

const { statsRoutes } = await import("./stats.js");

async function buildApp() {
  const app = Fastify();
  app.decorateRequest("jwtVerify", async () => undefined);
  await app.register(statsRoutes);
  return app;
}

describe("statsRoutes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-25T15:30:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("returns user request counts with the contract shape", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/stats/user-request-counts",
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.days).toHaveLength(30);
    expect(json.days[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(json.users).toHaveLength(1);
    expect(json.users[0]).toMatchObject({
      userId: 123,
      username: "alice",
      telegramId: 12345678,
      subscriptionPlan: "free",
      total: 8,
      counts: { "2026-06-22": 5, "2026-06-21": 3 },
    });
    await app.close();
  });

  it("respects the days query parameter", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/stats/user-request-counts?days=7",
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.getUserRequestCountsByDay).toHaveBeenCalledWith(7);
    expect(response.json().days).toHaveLength(7);
    await app.close();
  });

  it("defaults to 30 days when days is omitted", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/stats/user-request-counts",
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.getUserRequestCountsByDay).toHaveBeenCalledWith(30);
    await app.close();
  });

  it("does not include rows from the calendar day before the visible window", async () => {
    mocks.getUserRequestCountsByDay.mockResolvedValueOnce([
      {
        userId: 123,
        username: "alice",
        telegramId: 12345678,
        subscriptionPlan: "free",
        day: "2026-06-25",
        count: 2,
      },
      {
        userId: 123,
        username: "alice",
        telegramId: 12345678,
        subscriptionPlan: "free",
        day: "2026-06-24",
        count: 3,
      },
      {
        userId: 123,
        username: "alice",
        telegramId: 12345678,
        subscriptionPlan: "free",
        day: "2026-06-23",
        count: 99,
      },
    ]);
    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/stats/user-request-counts?days=2",
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.days).toEqual(["2026-06-25", "2026-06-24"]);
    expect(json.users[0].total).toBe(5);
    expect(json.users[0].counts).toEqual({ "2026-06-25": 2, "2026-06-24": 3 });
    await app.close();
  });
});
