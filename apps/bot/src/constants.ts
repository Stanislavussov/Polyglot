/**
 * Bot-specific display constants.
 *
 * Language data comes from the DB `languages` table (loaded via language cache).
 * This file only contains non-language constants.
 */

/** Max number of target languages a user can learn */
export const MAX_LEARNING_LANGS = 4;

/** Max number of daily notification times a user can configure */
export const MAX_NOTIFICATION_TIMES = 12;

/**
 * Telegram `file_id` of the optional onboarding screencast (Task 72), shown above
 * the final instruction screen.
 *
 * A constant rather than an environment variable on purpose: a `file_id` is not a
 * secret, it never changes once the asset is uploaded, and it does not differ
 * between environments. Routing it through `.env` → compose → a CI secret would
 * have been three moving parts for one opaque string, and would still have needed
 * a deploy to change — the deploy regenerates `.env` anyway.
 *
 * Empty means the asset does not exist yet, which is the normal state: producing
 * the video is out of scope for Task 72. Set it here when the screencast exists.
 */
export const ONBOARDING_SCREENCAST_FILE_ID = "";
