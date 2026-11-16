import { describe, expect, it, vi } from "vitest";
import { comgateFromEnv, createComgateProvider } from "./comgate.js";

function fakeFetch(replies: Record<string, object>) {
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const path = String(url).replace("https://payments.comgate.cz/v2.0", "");
    const body = replies[path];
    if (!body) throw new Error(`unexpected ${path}`);
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

const CONFIG = { merchant: "123", secret: "s3cret", test: true, recurring: true };
const ORDER = { orderId: "u7-1", label: "Polyglot Plus monthly", price: { amountMinor: 500, currency: "USD" } };

describe("comgate provider", () => {
  it("opens a recurring checkout with the order's price and returns Comgate's redirect", async () => {
    const http = fakeFetch({ "/payment.json": { code: 0, transId: "AB12", redirect: "https://pay/AB12" } });
    const provider = createComgateProvider({ ...CONFIG, fetch: http });

    const checkout = await provider.createCheckout({ ...ORDER, returnUrl: "https://learn.test/plan", recurring: true });

    expect(checkout).toEqual({ chargeId: "AB12", redirectUrl: "https://pay/AB12" });
    const [, init] = http.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      price: 500,
      curr: "USD",
      label: "Polyglot Plus mo",
      refId: "u7-1",
      initRecurring: true,
      test: true,
      url_paid: "https://learn.test/plan",
    });
    expect(new Headers(init?.headers).get("authorization")).toBe(`Basic ${btoa("123:s3cret")}`);
  });

  it("reads PAID with the charged amount, and CANCELLED as failed", async () => {
    const http = fakeFetch({
      "/payment/transId/P1.json": { code: 0, status: "PAID", price: "500", curr: "USD" },
      "/payment/transId/C1.json": { code: 0, status: "CANCELLED", price: "500", curr: "USD" },
    });
    const provider = createComgateProvider({ ...CONFIG, fetch: http });

    expect(await provider.fetchCharge("P1")).toEqual({
      status: "paid",
      price: { amountMinor: 500, currency: "USD" },
    });
    expect((await provider.fetchCharge("C1")).status).toBe("failed");
  });

  it("treats a refused renewal as a declined charge, not an outage", async () => {
    const http = fakeFetch({ "/recurring.json": { code: 1400, message: "card expired" } });
    const provider = createComgateProvider({ ...CONFIG, fetch: http });

    expect(await provider.chargeRenewal("AB12", ORDER)).toEqual({ chargeId: "declined-u7-1", status: "failed" });
  });

  it("rethrows a network failure on renewal, so the sweep never expires a payer over an outage", async () => {
    const provider = createComgateProvider({
      ...CONFIG,
      fetch: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    });

    await expect(provider.chargeRenewal("AB12", ORDER)).rejects.toThrow("fetch failed");
  });

  it("confirms a renewal through the status call before reporting it paid", async () => {
    const http = fakeFetch({
      "/recurring.json": { code: 0, transId: "R2" },
      "/payment/transId/R2.json": { code: 0, status: "PAID", price: "500", curr: "USD" },
    });
    const provider = createComgateProvider({ ...CONFIG, fetch: http });

    expect(await provider.chargeRenewal("AB12", ORDER)).toEqual({ chargeId: "R2", status: "paid" });
  });

  it("offers no renewal while recurring payments are not enabled for the shop", async () => {
    const provider = createComgateProvider({ ...CONFIG, recurring: false, fetch: fakeFetch({}) });
    expect(await provider.chargeRenewal("AB12", ORDER)).toBeNull();
  });

  it("stays off without credentials", () => {
    expect(comgateFromEnv({})).toBeNull();
    expect(comgateFromEnv({ COMGATE_MERCHANT: "1", COMGATE_SECRET: "x" })?.name).toBe("comgate");
  });
});
