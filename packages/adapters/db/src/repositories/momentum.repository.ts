// Source of truth moves to `@polyglot/core` and is re-exported from here once the
// core momentum module lands, exactly like NOTIFICATION_TYPES (notification.repository.ts:17).

/** Kinds that carry effort weight; 'praise' is a bookkeeping token and is not one of them. */
export const EFFORT_KINDS = ["translate", "save", "review", "mentor_turn", "mature"] as const;

export type EffortKind = (typeof EFFORT_KINDS)[number];

export type MomentumEventKind = EffortKind | "praise";
