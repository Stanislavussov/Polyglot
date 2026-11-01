/**
 * Spec: the mock checkout grants a paid plan for nothing, so it runs only where
 * `MOCK_PAYMENTS` explicitly turns it on (the dev stack). Anywhere else —
 * production included, and any value nobody meant as "on" — buying is closed and
 * a subscription bought through the mock earlier is not renewed, so it runs out
 * at the end of the period it already has.
 */
import type { RenewableSubscription } from "@polyglot/core";
import { describe, expect, it } from "vitest";
import { mockPaymentAdapter, purchasePaymentPort, renewalPaymentPort } from "./payment.js";

const SUBSCRIPTION: RenewableSubscription = {
  id: 1,
  plan: "plus",
  provider: "mock",
  externalId: null,
  currentPeriodEnd: new Date("2026-10-01T00:00:00Z"),
};

describe("purchasePaymentPort", () => {
  it.each(["on", "true", "1", "yes", " ON "])("opens the test checkout for MOCK_PAYMENTS=%j", (value) => {
    expect(purchasePaymentPort(value)).toBe(mockPaymentAdapter);
  });

  it.each([
    undefined,
    "",
    "off",
    "false",
    "0",
    "no",
    "enabled",
  ])("keeps buying closed for MOCK_PAYMENTS=%j", (value) => {
    expect(purchasePaymentPort(value)).toBeUndefined();
  });
});

describe("renewalPaymentPort", () => {
  it("does not renew a mock subscription once test payments are closed", async () => {
    const result = await renewalPaymentPort(undefined).verifyRenewal(SUBSCRIPTION);

    expect(result.paid).toBe(false);
  });

  it("keeps renewing through the mock while test payments are on", async () => {
    const result = await renewalPaymentPort("on").verifyRenewal(SUBSCRIPTION);

    expect(result).toEqual({ paid: true, periodEnd: new Date("2026-11-01T00:00:00Z") });
  });
});
