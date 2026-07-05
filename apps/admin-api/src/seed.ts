import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  adminUserRepository,
  closeDb,
  planFeatureAccessRepository,
  rateLimitPlanRepository,
} from "@polyglot/adapter-db";
import bcrypt from "bcryptjs";
import { config as dotenvConfig } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../../../.env") });

async function seed() {
  const PREMIUM_FEATURES = ["grammarBreakdown", "etymology", "grammarDetail"];

  const defaultPlans = [
    {
      name: "free",
      label: "Free",
      translationLimit: 20,
      creditCost: 1,
      videoLimit: 3,
      videoWindow: "lifetime" as const,
      isActive: true,
      isDefault: true,
      features: [] as string[],
    },
    {
      name: "plus",
      label: "Plus",
      translationLimit: null,
      creditCost: 1,
      videoLimit: 10,
      videoWindow: "monthly" as const,
      isActive: true,
      isDefault: false,
      features: PREMIUM_FEATURES,
    },
    {
      name: "pro",
      label: "Pro",
      translationLimit: null,
      creditCost: 1,
      videoLimit: null,
      videoWindow: "monthly" as const,
      isActive: true,
      isDefault: false,
      features: PREMIUM_FEATURES,
    },
    {
      name: "unlimited",
      label: "Unlimited",
      translationLimit: null,
      creditCost: 1,
      videoLimit: null,
      videoWindow: "monthly" as const,
      isActive: true,
      isDefault: false,
      features: PREMIUM_FEATURES,
    },
  ];

  // Idempotent: upsert every plan (updates columns on re-run) and sync its feature access.
  for (const { features, ...plan } of defaultPlans) {
    await rateLimitPlanRepository.upsert(plan);
    await planFeatureAccessRepository.setFeaturesForPlan(plan.name, features);
  }
  // biome-ignore lint/suspicious/noConsole: CLI script output
  console.log("Seeded/updated subscription plans and feature access");

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    // biome-ignore lint/suspicious/noConsole: CLI script output
    console.log("ADMIN_EMAIL and ADMIN_PASSWORD not set, skipping admin user");
    return;
  }

  const existing = await adminUserRepository.findByEmail(email);
  if (existing) {
    // biome-ignore lint/suspicious/noConsole: CLI script output
    console.log(`Admin user ${email} already exists`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await adminUserRepository.create({ email, passwordHash, role: "superadmin" });
  // biome-ignore lint/suspicious/noConsole: CLI script output
  console.log(`Created admin user: ${email}`);
}

seed()
  .then(() => closeDb())
  .catch(async (err) => {
    // biome-ignore lint/suspicious/noConsole: CLI script error output
    console.error(err);
    await closeDb();
    process.exit(1);
  });
