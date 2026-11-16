/**
 * The sandbox stands in for Comgate in development, so the real adapter must work
 * against it unchanged: create → checkout page → push → status → recurring charge.
 */
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ComgateError, createComgateProvider } from "@polyglot/adapter-payments";
import { afterEach, describe, expect, it } from "vitest";
import { createComgateSandbox } from "./comgate-sandbox.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function arrange() {
  const pushes: Record<string, unknown>[] = [];
  const notifyUrl = await listen(
    createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      pushes.push(JSON.parse(body) as Record<string, unknown>);
      response.writeHead(200).end();
    }),
  );
  // The sandbox needs its own URL before it can listen, so listen first on a placeholder config.
  const holder: { url: string } = { url: "" };
  const sandbox = createComgateSandbox({
    merchant: "m1",
    secret: "s1",
    notifyUrl,
    get publicUrl() {
      return holder.url;
    },
  });
  holder.url = await listen(sandbox);
  const provider = createComgateProvider({
    merchant: "m1",
    secret: "s1",
    test: true,
    recurring: true,
    baseUrl: `${holder.url}/v2.0`,
  });
  const order = { orderId: "u7-1", label: "Polyglot Plus", price: { amountMinor: 500, currency: "USD" } };
  return { provider, sandbox: holder.url, pushes, order };
}

describe("comgate sandbox", () => {
  it("runs the whole paid flow with the real adapter: checkout, push, status, monthly charge", async () => {
    const { provider, sandbox, pushes, order } = await arrange();

    const checkout = await provider.createCheckout({
      ...order,
      returnUrl: `http://shop.test/plan?charge=\${id}`,
      recurring: true,
    });
    expect(checkout.redirectUrl).toBe(`${sandbox}/pay/${checkout.chargeId}`);
    expect((await provider.fetchCharge(checkout.chargeId)).status).toBe("pending");

    const paid = await fetch(`${checkout.redirectUrl}/paid`, { method: "POST", redirect: "manual" });
    expect(paid.headers.get("location")).toBe(`http://shop.test/plan?charge=${checkout.chargeId}`);
    expect(pushes).toMatchObject([{ transId: checkout.chargeId, status: "PAID", merchant: "m1" }]);
    expect(await provider.fetchCharge(checkout.chargeId)).toEqual({
      status: "paid",
      price: { amountMinor: 500, currency: "USD" },
    });

    const renewal = await provider.chargeRenewal(checkout.chargeId, { ...order, orderId: "u7-2" });
    expect(renewal?.status).toBe("paid");
    expect(renewal?.chargeId).not.toBe(checkout.chargeId);
  });

  it("declines renewals when the dashboard says the bank declines", async () => {
    const { provider, sandbox, order } = await arrange();
    const checkout = await provider.createCheckout({ ...order, returnUrl: "http://shop.test/", recurring: true });
    await fetch(`${checkout.redirectUrl}/paid`, { method: "POST", redirect: "manual" });

    await fetch(`${sandbox}/settings`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "declineRenewals=on",
      redirect: "manual",
    });

    expect(await provider.chargeRenewal(checkout.chargeId, order)).toEqual({
      chargeId: "declined-u7-1",
      status: "failed",
    });
  });

  it("marks a declined checkout CANCELLED", async () => {
    const { provider, order } = await arrange();
    const checkout = await provider.createCheckout({ ...order, returnUrl: "http://shop.test/", recurring: true });

    await fetch(`${checkout.redirectUrl}/cancelled`, { method: "POST", redirect: "manual" });

    expect((await provider.fetchCharge(checkout.chargeId)).status).toBe("failed");
  });

  it("refuses wrong keys, as Comgate does", async () => {
    const { sandbox, order } = await arrange();
    const wrong = createComgateProvider({
      merchant: "m1",
      secret: "nope",
      test: true,
      recurring: true,
      baseUrl: `${sandbox}/v2.0`,
    });

    await expect(
      wrong.createCheckout({ ...order, returnUrl: "http://shop.test/", recurring: true }),
    ).rejects.toBeInstanceOf(ComgateError);
  });
});
