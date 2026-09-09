/**
 * Warm-up for the onboarding hook cards (Task 72, slice 4).
 *
 * Generates a real translation card for every curated hook word
 * (`packages/core/src/modules/onboarding/hook-words.ts`) in every learning
 * language, rendered for the native languages that matter first
 * (`ru`, `en`, `cs`), and caches the payload in `onboarding_demo_cards`.
 * Other native languages fall back to live generation on first use.
 *
 * The script lives in the bot app because that is where the translation
 * pipeline is wired: `container.ts` is the composition root that owns the AI
 * client, the admin-managed model defaults and the failover policy.
 *
 * Behaviour:
 * - Idempotent: every write goes through `onboardingDemoCardRepository.upsert`.
 * - A triple that is already cached is skipped unless `--force` is passed.
 * - `is_active` is never set — publishing stays a manual review step.
 * - Exits non-zero when it cannot start, or when any card failed to generate.
 *
 * Usage: `pnpm demo-cards:warm [--force]`
 */

import { closeDb, loadLanguageCache, onboardingDemoCardRepository } from "@polyglot/adapter-db";
import { getHookWordLanguages, getHookWords, logger, resolveOutputConfig, translate } from "@polyglot/core";
import { ConfigError, loadConfig } from "@polyglot/infra";
import { createContainer } from "../container.js";

/** Native languages the warm-up covers; everything else is generated on demand. */
const WARM_NATIVE_LANGS = ["ru", "en", "cs"];

/** Used only when the admin panel has no default model configured yet. */
const FALLBACK_MODEL = "openai/gpt-5-nano";

async function warmUp(force: boolean): Promise<number> {
  const container = createContainer();
  await loadLanguageCache();

  const configuredModel = await container.settings.getDefaultAIModel();
  if (!configuredModel) {
    logger.warn({ model: FALLBACK_MODEL }, "No default AI model configured; using fallback");
  }
  const model = configuredModel ?? FALLBACK_MODEL;

  // Hook cards are rendered with the default template, exactly like a card a
  // brand-new user gets before they have customized anything.
  const outputConfig = resolveOutputConfig(null, "word");

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const sourceLang of getHookWordLanguages()) {
    for (const nativeLang of WARM_NATIVE_LANGS) {
      if (nativeLang === sourceLang) continue;

      for (const [index, hook] of getHookWords(sourceLang).entries()) {
        const scope = { sourceLang, nativeLang, headword: hook.headword };

        if (!force && (await onboardingDemoCardRepository.hasCached(sourceLang, nativeLang, hook.headword))) {
          skipped += 1;
          logger.debug(scope, "Demo card already cached, skipping");
          continue;
        }

        try {
          const decision = await translate(
            {
              word: hook.headword,
              sourceLang,
              targetLangs: [nativeLang],
              nativeLang,
              model,
              interfaceLang: nativeLang,
              outputConfig,
            },
            container.ai.generateObject,
          );

          if (decision.status === "needs_clarification") {
            failed += 1;
            logger.error({ ...scope, reason: decision.ambiguity.reason }, "Demo card needs clarification, not cached");
            continue;
          }

          await onboardingDemoCardRepository.upsert({
            sourceLang,
            nativeLang,
            headword: hook.headword,
            payload: decision.output,
            sortOrder: index,
          });
          generated += 1;
          logger.info({ ...scope, status: decision.status }, "Demo card cached (inactive, pending review)");
        } catch (err) {
          failed += 1;
          logger.error({ ...scope, err }, "Demo card generation failed");
        }
      }
    }
  }

  logger.info({ generated, skipped, failed }, "Onboarding demo card warm-up finished");
  return failed;
}

try {
  loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    logger.error({ issues: err.issues }, "Invalid environment variables");
    process.exit(1);
  }
  throw err;
}

warmUp(process.argv.includes("--force"))
  .then((failed) => {
    if (failed > 0) process.exitCode = 1;
  })
  .catch((err) => {
    logger.error({ err }, "Onboarding demo card warm-up aborted");
    process.exitCode = 1;
  })
  .finally(closeDb);
