import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { adminUserRepository, closeDb, rateLimitPlanRepository } from "@polyglot/adapter-db";
import bcrypt from "bcryptjs";
import { config as dotenvConfig } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../../../.env") });

async function seed() {
  const defaultPlans = [
    {
      name: "free",
      label: "Free",
      creditsPerDay: 50,
      windowMs: 86_400_000,
      creditCost: 1,
      isActive: true,
      isDefault: true,
    },
    {
      name: "plus",
      label: "Plus",
      creditsPerDay: 300,
      windowMs: 86_400_000,
      creditCost: 1,
      isActive: true,
      isDefault: false,
    },
    {
      name: "pro",
      label: "Pro",
      creditsPerDay: 1500,
      windowMs: 86_400_000,
      creditCost: 1,
      isActive: true,
      isDefault: false,
    },
    {
      name: "unlimited",
      label: "Unlimited",
      creditsPerDay: null,
      windowMs: 86_400_000,
      creditCost: 1,
      isActive: true,
      isDefault: false,
    },
  ];

  const existingPlans = await rateLimitPlanRepository.findAll();
  if (existingPlans.length === 0) {
    for (const plan of defaultPlans) {
      await rateLimitPlanRepository.upsert(plan);
    }
    // biome-ignore lint/suspicious/noConsole: CLI script output
    console.log("Created default subscription plans");
  } else {
    // biome-ignore lint/suspicious/noConsole: CLI script output
    console.log("Subscription plans already exist; skipping default plan seed");
  }

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
