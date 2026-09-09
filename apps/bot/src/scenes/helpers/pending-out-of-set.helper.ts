import type { SessionData } from "../../types.js";
import { setEvictingEntry } from "../../utils/evicting-map.js";

/**
 * Maximum pending out-of-set prompts kept in {@link SessionData.pendingOutOfSet}.
 * A prompt's entry is only removed when the user taps one of its buttons, so a
 * user who keeps typing out-of-set words and ignoring the prompts would
 * otherwise grow the map without bound. Evicted prompts fall through the
 * existing stale-button guard in `handleOutOfSetCallback`.
 */
export const MAX_PENDING_OUT_OF_SET = 10;

type PendingOutOfSetEntry = NonNullable<SessionData["pendingOutOfSet"]>[string];

/**
 * Stores an out-of-set prompt in the session, evicting the least-recently-added
 * prompts past {@link MAX_PENDING_OUT_OF_SET} (see `setEvictingEntry` for why
 * eviction is by insertion stamp rather than message id).
 */
export function setPendingOutOfSet(session: SessionData, msgId: number, entry: PendingOutOfSetEntry): void {
  session.pendingOutOfSet ??= {};
  setEvictingEntry(session.pendingOutOfSet, msgId, entry, MAX_PENDING_OUT_OF_SET);
}
