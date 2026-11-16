import type { CreatePaymentInput, Payment, PaymentRepository } from "@polyglot/core";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../connection.js";
import { payments } from "../schema.js";

export const paymentRepository: PaymentRepository = {
  async create(input: CreatePaymentInput): Promise<Payment> {
    const [row] = await getDb()
      .insert(payments)
      .values({
        ...input,
        subscriptionId: input.subscriptionId ?? null,
        paidAt: input.status === "paid" ? new Date() : null,
      })
      .returning();
    return row!;
  },

  async findByCharge(provider, chargeId) {
    const rows = await getDb()
      .select()
      .from(payments)
      .where(and(eq(payments.provider, provider), eq(payments.chargeId, chargeId)))
      .limit(1);
    return rows[0] ?? null;
  },

  async claimPaid(id, paidAt) {
    // The status guard in the WHERE makes the transition atomic: two concurrent
    // notifications both run this, exactly one gets a row back.
    const rows = await getDb()
      .update(payments)
      .set({ status: "paid", paidAt })
      .where(and(eq(payments.id, id), eq(payments.status, "pending")))
      .returning();
    return rows[0] ?? null;
  },

  async releaseClaim(id) {
    await getDb()
      .update(payments)
      .set({ status: "pending", paidAt: null })
      .where(and(eq(payments.id, id), eq(payments.status, "paid")));
  },

  async markFailed(id) {
    await getDb()
      .update(payments)
      .set({ status: "failed" })
      .where(and(eq(payments.id, id), eq(payments.status, "pending")));
  },

  async attachSubscription(id, subscriptionId) {
    await getDb().update(payments).set({ subscriptionId }).where(eq(payments.id, id));
  },

  async findLastPaidForSubscription(subscriptionId) {
    const rows = await getDb()
      .select()
      .from(payments)
      .where(and(eq(payments.subscriptionId, subscriptionId), eq(payments.status, "paid")))
      .orderBy(desc(payments.id))
      .limit(1);
    return rows[0] ?? null;
  },
};
