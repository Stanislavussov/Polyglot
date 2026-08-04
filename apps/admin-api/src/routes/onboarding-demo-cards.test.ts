import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const inactiveCard = {
  id: 1,
  sourceLang: "de",
  nativeLang: "ru",
  headword: "Backpfeifengesicht",
  payload: {
    original: "Backpfeifengesicht",
    sourceLang: "de",
    nativeMeaning: "лицо, которое просит кирпича",
    nativeSynonyms: [],
    translations: {},
  },
  sortOrder: 0,
  isActive: false,
  createdAt: new Date("2026-07-20T00:00:00Z"),
};

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  setActive: vi.fn(),
}));

vi.mock("@polyglot/adapter-db", () => ({
  onboardingDemoCardRepository: {
    list: mocks.list,
    setActive: mocks.setActive,
  },
}));

const { onboardingDemoCardRoutes } = await import("./onboarding-demo-cards.js");

async function buildApp() {
  const app = Fastify();
  app.decorateRequest("jwtVerify", async () => undefined);
  await app.register(onboardingDemoCardRoutes);
  return app;
}

describe("onboardingDemoCardRoutes", () => {
  beforeEach(() => {
    mocks.list.mockResolvedValue({
      cards: [inactiveCard],
      total: 1,
      page: 1,
      limit: 20,
      counts: { cached: 42, active: 0 },
    });
    mocks.setActive.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("lists unreviewed cards with their payload so a reviewer can read them", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/onboarding-demo-cards" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      cards: [{ headword: "Backpfeifengesicht", isActive: false, payload: { nativeMeaning: expect.any(String) } }],
      total: 1,
      counts: { cached: 42, active: 0 },
    });
    expect(mocks.list).toHaveBeenCalledWith({ page: 1, limit: 20 });
    await app.close();
  });

  it("passes language, review-state and search filters through", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "GET",
      url: "/onboarding-demo-cards?page=2&limit=50&sourceLang=de&nativeLang=ru&isActive=false&search=%20Back%20",
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({
      page: 2,
      limit: 50,
      sourceLang: "de",
      nativeLang: "ru",
      isActive: false,
      search: "Back",
    });
    await app.close();
  });

  it("treats an empty review-state filter as no filter at all", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/onboarding-demo-cards?isActive=" });

    expect(response.statusCode).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({ page: 1, limit: 20 });
    await app.close();
  });

  it("rejects an out-of-range page size", async () => {
    const app = await buildApp();

    const response = await app.inject({ method: "GET", url: "/onboarding-demo-cards?limit=500" });

    expect(response.statusCode).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
    await app.close();
  });

  it("publishes a reviewed card", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "PUT",
      url: "/onboarding-demo-cards/active",
      payload: { sourceLang: "de", nativeLang: "ru", headword: "Backpfeifengesicht", isActive: true },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.setActive).toHaveBeenCalledWith("de", "ru", "Backpfeifengesicht", true);
    expect(response.json()).toEqual({
      sourceLang: "de",
      nativeLang: "ru",
      headword: "Backpfeifengesicht",
      isActive: true,
    });
    await app.close();
  });

  it("un-publishes a card that should no longer be served", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "PUT",
      url: "/onboarding-demo-cards/active",
      payload: { sourceLang: "de", nativeLang: "ru", headword: "Backpfeifengesicht", isActive: false },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.setActive).toHaveBeenCalledWith("de", "ru", "Backpfeifengesicht", false);
    await app.close();
  });

  it("returns 404 when the triple has no cached card", async () => {
    mocks.setActive.mockResolvedValue(false);
    const app = await buildApp();

    const response = await app.inject({
      method: "PUT",
      url: "/onboarding-demo-cards/active",
      payload: { sourceLang: "de", nativeLang: "ru", headword: "nope", isActive: true },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("returns 400 for a non-boolean review flag", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "PUT",
      url: "/onboarding-demo-cards/active",
      payload: { sourceLang: "de", nativeLang: "ru", headword: "Backpfeifengesicht", isActive: "yes" },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.setActive).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 400 when the natural key is incomplete", async () => {
    const app = await buildApp();

    const response = await app.inject({
      method: "PUT",
      url: "/onboarding-demo-cards/active",
      payload: { sourceLang: "de", headword: "Backpfeifengesicht", isActive: true },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.setActive).not.toHaveBeenCalled();
    await app.close();
  });
});
