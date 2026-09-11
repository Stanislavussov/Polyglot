/**
 * Product-event recording — grammY e2e integration test.
 *
 * Drives the real dispatcher, the real DI container and the real Postgres to
 * pin down that the admin panel's funnel is made of facts the bot actually
 * writes: a Free user tapping a paid button leaves a `feature.locked` and a
 * `paywall.shown` row, picking a plan leaves `plan.selected`, and paying leaves
 * `plan.confirmed` — each stamped with the plan the user was ON at the time,
 * which is the column the whole funnel is read through.
 *
 * What a mock-only test cannot pin down and this does: that the events survive
 * the composition root (the repository is really wired into `ServiceContainer`),
 * and that `plan.confirmed` records the BUYER's old plan rather than the plan
 * they just bought — the two are written by the same handler, one line apart.
 *
 * Recording is deliberately fire-and-forget (see `observability/product-events.ts`),
 * so the rows land shortly AFTER the update finishes. Reads here poll rather
 * than assert once — asserting immediately would test the scheduler, not the
 * feature.
 */
import { getDb } from "@polyglot/adapter-db";
import { describe, expect, it } from "vitest";
import { arrangeOnboardedTranslator } from "../../test-helpers/integration/arrange.js";
import {
  type BotHarness,
  callbackQueryUpdate,
  createBotHarness,
  lastRenderedCard,
  messageUpdate,
} from "../../test-helpers/integration/bot-harness.js";
import { uniqueTelegramId } from "../../test-helpers/integration/id-factory.js";
import { deterministicTranslateAi } from "../../test-helpers/integration/translate-ai-mock.js";

interface ProductEventRow {
  event: string;
  context: string | null;
  plan: string | null;
}

/**
 * `drizzle-orm` is not a dependency of `apps/bot` (only the adapter owns it) and
 * the port is write-only by design, so the rows are read through the driver the
 * adapter exposes — the same route `momentum-recording` takes.
 */
function readProductEvents(userId: number): Promise<ProductEventRow[]> {
  return getDb().$client<ProductEventRow[]>`
    select event, context, plan
    from product_events
    where user_id = ${userId}
    order by id asc
  `;
}

/** Poll until `count` rows have landed, so a fire-and-forget write is not a race. */
async function waitForEvents(userId: number, count: number): Promise<ProductEventRow[]> {
  const deadline = Date.now() + 5000;
  let rows = await readProductEvents(userId);
  while (rows.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    rows = await readProductEvents(userId);
  }
  return rows;
}

const named = (rows: ProductEventRow[], event: string): ProductEventRow[] => rows.filter((row) => row.event === event);

/** Send a word and return the id of the card the bot rendered. */
async function renderCard(harness: BotHarness, chatId: number): Promise<number> {
  await harness.dispatch(messageUpdate({ chatId, fromId: chatId, text: "hello" }));
  return lastRenderedCard(harness.sent).messageId;
}

describe("product events (integration)", () => {
  it("records the purchase funnel a Free user walks, stamped with the plan they were on", async () => {
    // Arrange
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id); // free plan
    const messageId = await renderCard(harness, id);
    const tap = (data: string) => harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId, data }));

    // Act — the whole funnel: refused paid button → plan picked → paid.
    await tap(`tr:say:cs:${messageId}`);
    await tap("plan:buy:plus");
    await tap("plan:confirm:plus");

    // Assert — every step is on record, in order.
    const rows = await waitForEvents(userId, 4);
    expect(rows.map((row) => row.event)).toEqual([
      "feature.locked",
      "paywall.shown",
      "plan.selected",
      "plan.confirmed",
    ]);

    // The refusal names the feature that refused, not a generic "paywall".
    expect(named(rows, "feature.locked")[0]).toMatchObject({ context: "pronunciation", plan: "free" });
    expect(named(rows, "paywall.shown")[0]).toMatchObject({ context: "pronunciation" });
    expect(named(rows, "plan.selected")[0]).toMatchObject({ context: "plus", plan: "free" });
    // The buyer was Free at the moment of buying — a row stamped `plus` here would
    // make every conversion look like it came from an existing subscriber.
    expect(named(rows, "plan.confirmed")[0]).toMatchObject({ context: "plus", plan: "free" });
  });

  it("records a paid feature as used once the plan covers it, and counts backing out separately", async () => {
    // Arrange
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);
    const messageId = await renderCard(harness, id);
    const tap = (data: string) => harness.dispatch(callbackQueryUpdate({ chatId: id, fromId: id, messageId, data }));

    // Act — back out of one purchase, then buy Pro and use a Pro-only feature.
    await tap("plan:buy:pro");
    await tap("plan:cancel");
    await tap("plan:buy:pro");
    await tap("plan:confirm:pro");
    await tap(`tr:say:cs:${messageId}`);

    // Assert
    const rows = await waitForEvents(userId, 5);
    // The abandoned checkout is its own event, so a picked-but-unpaid plan is not
    // silently indistinguishable from one that was never picked.
    expect(named(rows, "plan.canceled")).toHaveLength(1);
    expect(named(rows, "plan.selected")).toHaveLength(2);
    expect(named(rows, "plan.confirmed")).toHaveLength(1);

    // The same button that produced `feature.locked` for a Free user now produces
    // `feature.used` — one gate, both outcomes, which is what makes the admin
    // panel's used/blocked split trustworthy.
    const used = named(rows, "feature.used");
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({ context: "pronunciation", plan: "pro" });
    expect(named(rows, "feature.locked")).toHaveLength(0);
  });

  it("counts every slash command without per-command instrumentation", async () => {
    // Arrange
    const harness = createBotHarness({ ai: deterministicTranslateAi() });
    const id = uniqueTelegramId();
    const userId = await arrangeOnboardedTranslator(id);

    // Act
    await harness.dispatch(messageUpdate({ chatId: id, fromId: id, text: "/translate" }));

    // Assert — the command, and the mode switch it caused.
    const rows = await waitForEvents(userId, 2);
    expect(named(rows, "command.used")[0]).toMatchObject({ context: "translate", plan: "free" });
    expect(named(rows, "mode.switched")[0]).toMatchObject({ context: "translate" });
  });
});
