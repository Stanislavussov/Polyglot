/**
 * Goal-ladder backfill: closes the ended months still inside the journal's 90-day
 * window for every user who learned in it, so the ladder does not open at 0/5 for
 * someone who has been practising for weeks. Rows are marked `source = 'backfill'`
 * (approximate: plan-days are rebuilt from mutable subscription rows) and never
 * grant a reward.
 *
 * Re-runs are no-ops in the data: `closeAndClaim` only inserts months missing from
 * the ledger. Remove this file, `backfill-progress-months.cli.ts` and its
 * `deploy.yml` step on 2027-03-01 or one week after the first master deploy that
 * carried it, whichever is later.
 */
import { parseMotivationConfig, progressGoalsConfig } from "@polyglot/core";
import { progressRepository } from "./repositories/progress.repository.js";
import { systemSettingsRepository } from "./repositories/system-settings.repository.js";
import { DEFAULT_RETENTION_DAYS } from "./retention.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ProgressBackfillResult {
  users: number;
  monthsClosed: number;
}

export async function runProgressBackfill(
  options: { now?: Date; userIds?: number[] } = {},
): Promise<ProgressBackfillResult> {
  const now = options.now ?? new Date();
  const config = progressGoalsConfig(parseMotivationConfig(await systemSettingsRepository.get("motivation")));
  const userIds =
    options.userIds ??
    (await progressRepository.listActiveUserIds(new Date(now.getTime() - DEFAULT_RETENTION_DAYS * MS_PER_DAY), now));

  let monthsClosed = 0;
  // Sequential on purpose: each call is a short transaction, and a burst of them in
  // parallel would hold that many pool connections while the old image still serves.
  for (const userId of userIds) {
    const result = await progressRepository.closeAndClaim({ userId, now, config, grant: false, source: "backfill" });
    monthsClosed += result.closedMonths.length;
  }
  return { users: userIds.length, monthsClosed };
}
