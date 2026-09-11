/**
 * Canonical list of bot modes — the single source of truth.
 * Both the {@link UserMode} union and every runtime `VALID_MODES` set are
 * derived from this array, so a newly added mode cannot be silently omitted
 * from session validation (adding one here updates the type and all guards).
 */
export const USER_MODES = ["idle", "translate", "mentor"] as const;

/**
 * Active mode for the bot — determines how plain text messages are routed.
 * Persisted in DB (userLanguageSettings.activeMode) to survive bot restarts.
 * Derived from {@link USER_MODES}; add new modes there.
 */
export type UserMode = (typeof USER_MODES)[number];
