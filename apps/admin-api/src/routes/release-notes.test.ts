import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn((input: unknown) => Promise.resolve({ id: 42, ...(input as Record<string, unknown>) })),
  list: vi.fn(() => Promise.resolve([{ id: 41, status: "sent" }])),
}));

vi.mock("@polyglot/adapter-db", () => ({
  releaseAnnouncementJobRepository: { enqueue: mocks.enqueue, list: mocks.list },
}));

// The unified auth hook populates `request.adminUser` in production; here the
// role gate is stubbed so the route's own behaviour is what is under test.
vi.mock("../plugins/auth.js", () => ({ requireRole: () => async () => {} }));

const { releaseNoteRoutes } = await import("./release-notes.js");

async function buildApp() {
  const app = Fastify();
  app.addHook("onRequest", async (request) => {
    request.adminUser = { adminId: 1, email: "editor@polyglot.test", role: "superadmin" };
  });
  await app.register(releaseNoteRoutes);
  return app;
}

describe("releaseNoteRoutes", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("serves the pending queue, the enforced languages and recent sends", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/release-notes" });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    // Read from the repository's own queue, which the CI gate keeps non-empty.
    expect(body.notes.length).toBeGreaterThan(0);
    expect(body.notes[0]).toMatchObject({
      id: expect.any(String),
      texts: expect.objectContaining({ en: expect.any(String) }),
    });
    expect(body.languages).toContain("en");
    expect(body.jobs).toEqual([{ id: 41, status: "sent" }]);
  });

  it("queues a send for the bot and answers 202, naming the editor", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/release-notes/send",
      payload: { notes: [{ id: "abc123", texts: { en: "First change.", ru: "Первое изменение." } }] },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ jobId: 42 });
    expect(mocks.enqueue).toHaveBeenCalledWith({
      notes: [{ id: "abc123", texts: { en: "First change.", ru: "Первое изменение." } }],
      audienceGroups: ["admin", "tester"],
      createdBy: "editor@polyglot.test",
    });
  });

  it("refuses an empty send instead of queueing a message with nothing in it", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "POST", url: "/release-notes/send", payload: { notes: [] } });

    expect(response.statusCode).toBe(400);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("refuses a note whose text would not fit one Telegram message", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "POST",
      url: "/release-notes/send",
      payload: { notes: [{ id: "abc123", texts: { en: "x".repeat(3501) } }] },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
