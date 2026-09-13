#!/usr/bin/env tsx
/**
 * Restore native translations that background enrichment deleted. What it selects
 * and what it leaves alone lives in `native-translation-repair.ts`; this is the
 * hand on the switch.
 *
 *   pnpm repair:native-translations            # report only
 *   pnpm repair:native-translations --apply    # write
 */

import { parseArgs } from "node:util";
import { closeDb, findRepairableNativeTranslations, restoreNativeTranslations } from "@polyglot/adapter-db";
import { config as dotenvConfig } from "dotenv";

dotenvConfig();

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { apply: { type: "boolean", default: false } } });

  const repairable = await findRepairableNativeTranslations();
  const bySource = repairable.reduce<Record<string, number>>((acc, row) => {
    acc[row.source] = (acc[row.source] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`${repairable.length} entries are missing their native translation and can be restored.`);
  for (const [source, count] of Object.entries(bySource)) console.log(`  ${source}: ${count}`);
  for (const row of repairable.slice(0, 10)) {
    console.log(`  #${row.entryId} "${row.original}" → ${row.nativeLang.toUpperCase()}: ${row.text}`);
  }
  if (repairable.length > 10) console.log(`  … and ${repairable.length - 10} more`);

  if (!values.apply) {
    console.log("\nDry run — pass --apply to write.");
    return;
  }

  console.log(`\nRestored ${await restoreNativeTranslations(repairable)} translation rows.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
