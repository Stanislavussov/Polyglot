import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { adminUserRepository, aiModelRepository, closeDb, wordPickerPresetRepository } from "@polyglot/adapter-db";
import { DEFAULT_WORD_PICKER_PRESETS } from "@polyglot/core";
import bcrypt from "bcryptjs";
import { config as dotenvConfig } from "dotenv";
import { bootstrapPlanCatalog } from "./plan-catalog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../../../.env") });

async function seed() {
  // Bootstrap-only, like every other block in this file: plans that already
  // exist are never touched, so limits, prices and feature access are
  // admin-owned state from the moment a row exists. The catalog itself (and the
  // tier-matrix rationale) lives in plan-catalog.ts so tests can import it
  // without running this script.
  const createdPlans = await bootstrapPlanCatalog();
  // biome-ignore lint/suspicious/noConsole: CLI script output
  console.log(
    createdPlans.length > 0
      ? `Seeded subscription plans: ${createdPlans.join(", ")}`
      : "Subscription plan catalog already present — left untouched",
  );

  // Model ids now live ONLY in `ai_models`, so an empty table is not a soft
  // "unconfigured" state: resolveDefaultAIModel finds no plan model, no default
  // and no fallback, and every AI call throws AIModelNotConfiguredError. A newly
  // provisioned deployment must answer before an admin has opened the panel, so
  // the bootstrap gives the catalog one enabled default model.
  //
  // Guarded on the table being EMPTY rather than upserted per row: unlike plans,
  // the model catalog — and which model holds the default/fallback role — is
  // admin-owned state, and this seed re-runs on every production deploy
  // (deploy.yml). Re-asserting a row here would silently reset an admin's model
  // choice on each release. No fallback is flagged: with a single model a
  // failover split would target the model that just failed, and "no fallback" is
  // an explicitly supported state.
  const existingModels = await aiModelRepository.findAll();
  if (existingModels.length === 0) {
    await aiModelRepository.upsert({
      id: "google/gemini-3.1-flash-lite",
      name: "Google: Gemini 3.1 Flash Lite",
      provider: "google",
      maxTokens: 1_048_576,
      costPer1kInput: 0.00025,
      costPer1kOutput: 0.0015,
      isEnabled: true,
      isDefault: true,
      isFallback: false,
    });
    // biome-ignore lint/suspicious/noConsole: CLI script output
    console.log("Seeded bootstrap AI model: google/gemini-3.1-flash-lite (default)");
  } else {
    // biome-ignore lint/suspicious/noConsole: CLI script output
    console.log(`AI model catalog already holds ${existingModels.length} model(s) — left untouched`);
  }

  // Word-picker angles ship as data, not code: the bot reads them from the DB and
  // the admin panel owns them from then on. Inserted per slug and never updated,
  // so an angle an admin has rewritten (or deliberately deleted) is not resurrected
  // or overwritten by the next deploy's seed run.
  let insertedAngles = 0;
  for (const preset of DEFAULT_WORD_PICKER_PRESETS) {
    const inserted = await wordPickerPresetRepository.insertIfMissing({
      slug: preset.slug,
      emoji: preset.emoji,
      title: preset.title,
      titleI18n: preset.titleI18n,
      prompt: preset.prompt,
      learningLangs: [],
      sortOrder: preset.sortOrder,
      isActive: true,
    });
    if (inserted) insertedAngles++;
  }
  // biome-ignore lint/suspicious/noConsole: CLI script output
  console.log(
    `Word-picker angles: ${insertedAngles} added, ${DEFAULT_WORD_PICKER_PRESETS.length - insertedAngles} already present`,
  );

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
