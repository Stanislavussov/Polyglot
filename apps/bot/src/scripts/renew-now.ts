/**
 * Development only: run the monthly renewal for one user now, instead of waiting a
 * month. Moves the user's active subscription to "just ended", then runs the same
 * sweep the scheduler runs, through the same provider routing.
 *
 *   pnpm renew-now <userId>
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";

const say = (line: string) => process.stdout.write(`${line}\n`);
const fail = (line: string) => process.stderr.write(`${line}\n`);
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../../../../.env") });

if (process.env.NODE_ENV === "production") {
  fail("renew-now refuses to run with NODE_ENV=production");
  process.exit(1);
}

const userId = Number.parseInt(process.argv[2] ?? "", 10);
if (!Number.isSafeInteger(userId) || userId <= 0) {
  fail("usage: pnpm renew-now <userId>");
  process.exit(1);
}

const { closeDb, subscriptionRepository, userRepository } = await import("@polyglot/adapter-db");
const { createSubscriptionService } = await import("@polyglot/core");
const { renewalPaymentPort } = await import("../payment.js");

const active = await subscriptionRepository.findActiveByUser(userId);
if (!active) {
  fail(`user ${userId} has no active subscription`);
  await closeDb();
  process.exit(1);
}
await subscriptionRepository.extend(active.id, new Date(Date.now() - 60_000));

// Only this user's row: the real sweep reads every due row, and other people's are not ours to touch here.
const subscriptions = Object.assign(Object.create(subscriptionRepository) as typeof subscriptionRepository, {
  findExpired: async (now: Date) =>
    (await subscriptionRepository.findExpired(now)).filter((sub) => sub.userId === userId),
});
const result = await createSubscriptionService({
  payment: renewalPaymentPort(),
  subscriptions,
  users: userRepository,
}).processRenewals();

const after = await subscriptionRepository.findActiveByUser(userId);
say(
  result.renewed
    ? `renewed: ${active.plan} via ${active.provider}, now until ${after?.currentPeriodEnd.toISOString()}`
    : `not renewed: subscription expired, user is on ${(await userRepository.findById(userId))?.subscriptionPlan}`,
);
await closeDb();
