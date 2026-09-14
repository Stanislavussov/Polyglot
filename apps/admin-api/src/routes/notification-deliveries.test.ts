import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(() =>
    Promise.resolve({
      deliveries: [
        {
          id: 5,
          userId: 10,
          kind: "word_card",
          text: "<b>Haus</b>",
          parseMode: "HTML",
          meta: { word: "Haus", source: "srs", entryId: 3 },
          sentAt: new Date("2026-09-13T08:00:00Z"),
          user: { id: 10, telegramId: 12345, username: "polyglot_user" },
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    }),
  ),
}));

vi.mock("@polyglot/adapter-db", () => ({
  NOTIFICATION_DELIVERY_KINDS: [
    "word_card",
    "re_engagement",
    "dictionary_empty",
    "activation_nudge",
    "trial",
    "release_announcement",
  ],
  notificationDeliveryRepository: { list: mocks.list },
}));

const { notificationDeliveryRoutes } = await import("./notification-deliveries.js");

async function buildApp() {
  const app = Fastify();
  await app.register(notificationDeliveryRoutes);
  return app;
}

describe("notificationDeliveryRoutes", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lists deliveries newest-first as the repository returns them, with default paging", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/notification-deliveries" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ deliveries: [{ id: 5, kind: "word_card" }], total: 1 });
    expect(mocks.list).toHaveBeenCalledWith({ page: 1, limit: 20 });
    await app.close();
  });

  it("narrows to one user, one kind and a trimmed search", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/notification-deliveries?userId=10&kind=trial&search=%20haus%20&page=2&limit=50",
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({ page: 2, limit: 50, userId: 10, kind: "trial", search: "haus" });
    await app.close();
  });

  it("clamps an oversized page size", async () => {
    const app = await buildApp();

    await app.inject({ method: "GET", url: "/notification-deliveries?limit=100000" });

    expect(mocks.list).toHaveBeenCalledWith({ page: 1, limit: 100 });
    await app.close();
  });

  it.each([
    ["an unknown kind", "kind=push"],
    ["a non-numeric user id", "userId=abc"],
    ["a user id past the int4 range", "userId=99999999999"],
  ])("rejects %s with 400 without querying", async (_label, query) => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: `/notification-deliveries?${query}` });

    expect(response.statusCode).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
    await app.close();
  });
});
