/**
 * Shared arrange helpers for the bot e2e integration lane (Task 71).
 */
import {
  getDb,
  getLang,
  notificationRepository,
  onboardingDemoCardRepository,
  userRepository,
  vocabularyRepository,
} from "@polyglot/adapter-db";
import { getHookWords } from "@polyglot/core";

/**
 * The UTC slot the notification-delivery e2e lane owns, and nothing else may use.
 *
 * `checkAndSend` scans the whole table and the integration database is shared
 * across files and workers, so a delivery test that used the common 08:00 slot
 * would pick up rows seeded by
 * `packages/adapters/db/src/__tests__/notification.repository.integration.test.ts`
 * (which pins itself to 08:00 and deliberately never cleans up). Owning a slot
 * nobody else configures is what makes the lane deterministic; the injected
 * `SchedulerDeps.now` is what lets a test claim it.
 */
export const DELIVERY_TEST_SLOT_UTC = { hour: 13, minute: 0 } as const;

/** `DELIVERY_TEST_SLOT_UTC` rendered as the `HH:MM` string the schedule column stores. */
export const DELIVERY_TEST_SLOT_TIME = `${String(DELIVERY_TEST_SLOT_UTC.hour).padStart(2, "0")}:${String(
  DELIVERY_TEST_SLOT_UTC.minute,
).padStart(2, "0")}`;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The seeded entry's headword — the string a delivery test looks for on the wire. */
const NOTIFIABLE_HEADWORD = "bridge";
/** `richCard` payload — distinct strings so a layout assertion can index each line. */
const RICH_NATIVE_TRANSLATION = "мост";
const RICH_OTHER_TRANSLATION = "Brücke";
const RICH_NATIVE_MEANING = "Сооружение для перехода через препятствие.";

export interface NotifiableUserOptions {
  /** Configured slots, as `HH:MM`. Defaults to the delivery lane's own slot. */
  notificationTimes?: string[];
  /** Defaults to true. */
  notificationEnabled?: boolean;
  /** Seed a verified vocabulary entry with one resolvable translation. Defaults to true. */
  withVocabulary?: boolean;
  /**
   * Seed a card rich enough to assert the notification's *layout*, not just its
   * presence: a non-English native language, two learning languages, a stored
   * `nativeMeaning`, and a translation into the native language.
   *
   * The default fixture cannot express a layout assertion at all — its user is
   * `en`-native with a single `cs` translation and no `nativeMeaning`, so
   * "the native answer precedes the meaning" has neither operand and passes
   * vacuously. Anything asserting card order must set this.
   */
  richCard?: boolean;
  /** Source-language synonyms stored on the seeded entry, for the notification template. */
  sourceSynonyms?: string[];
}

export interface NotifiableUser {
  userId: number;
  headword: string;
  /** Present only under `richCard` — the strings a layout assertion needs. */
  nativeTranslation?: string;
  nativeMeaning?: string;
  otherTranslation?: string;
}

/**
 * Provision a user the notification scheduler will deliver to: onboarded,
 * notifications on, timezone UTC, one configured slot, and — unless disabled — a
 * dictionary entry the picker can actually use.
 *
 * The vocabulary half is not optional decoration. `pickDictionaryWord` returns
 * `null` when the user has no entries, when every entry is `unverified`, and when
 * no translation resolves through `getLangCode` — and on `null` the batch routes
 * to `sendDictionaryEmptyPrompt` instead. A delivery test with a half-seeded
 * fixture therefore fails on a `notifNoDictionary` text mismatch, which looks
 * like a delivery bug and is not one. An entry with an EMPTY translations array
 * is worse still: it triggers the just-in-time `translateEntry` path, which calls
 * the AI and writes to the database.
 */
export async function arrangeNotifiableUser(
  telegramId: number,
  options: NotifiableUserOptions = {},
): Promise<NotifiableUser> {
  const {
    notificationTimes = [DELIVERY_TEST_SLOT_TIME],
    notificationEnabled = true,
    withVocabulary = true,
    richCard = false,
    sourceSynonyms,
  } = options;

  const user = await userRepository.create({ telegramId, username: "notifiable" });
  await userRepository.markOnboarded(user.id);
  await userRepository.updateSettings(user.id, {
    interfaceLang: "en",
    nativeLang: richCard ? "ru" : "en",
    learningLangs: richCard ? ["cs", "de"] : ["cs"],
    lastSourceLang: null,
  });

  // Vocabulary BEFORE the schedule, deliberately. Enabling first would mean a
  // throw in this block (an unloaded language cache) leaves an enabled subscriber
  // pinned to the delivery lane's slot in the shared database, with the caller
  // holding no id to clean up — the row would outlive the run. Seeding first
  // makes that window impossible rather than merely unlikely: nothing is
  // notifiable until the last statement below succeeds.
  if (withVocabulary) {
    const sourceLang = getLang("en");
    const targetLang = getLang("cs");
    if (!sourceLang || !targetLang) {
      throw new Error("arrangeNotifiableUser: language cache is not loaded (en/cs missing)");
    }
    const nativeLang = richCard ? getLang("ru") : undefined;
    const secondLang = richCard ? getLang("de") : undefined;
    if (richCard && (!nativeLang || !secondLang)) {
      throw new Error("arrangeNotifiableUser: language cache is not loaded (ru/de missing)");
    }
    await vocabularyRepository.create(user.id, {
      original: NOTIFIABLE_HEADWORD,
      sourceLangId: sourceLang.id,
      inputType: "word",
      emoji: "🌉",
      unverified: false,
      ...(richCard ? { nativeMeaning: RICH_NATIVE_MEANING } : {}),
      ...(sourceSynonyms
        ? { sourceUsage: { explanation: "", synonyms: sourceSynonyms.map((text) => ({ text })), examples: [] } }
        : {}),
      // Seeded native-last on purpose: the card must be reordered at render
      // time, so a fixture that already reads native-first would prove nothing.
      translations: [
        { targetLangId: targetLang.id, text: "most", details: { synonyms: [], examples: [] } },
        ...(richCard && secondLang && nativeLang
          ? [
              { targetLangId: secondLang.id, text: RICH_OTHER_TRANSLATION, details: { synonyms: [], examples: [] } },
              { targetLangId: nativeLang.id, text: RICH_NATIVE_TRANSLATION, details: { synonyms: [], examples: [] } },
            ]
          : []),
      ],
    });
  }

  // `timezone` defaults to "UTC" and `is_active` to true (schema.ts), and a NULL
  // `last_interaction_at` is explicitly eligible in `getUsersForWindow` — so the
  // schedule is the only thing this fixture has to state.
  await notificationRepository.updatePrefs(user.id, { notificationEnabled, notificationTimes });

  return {
    userId: user.id,
    headword: NOTIFIABLE_HEADWORD,
    ...(richCard
      ? {
          nativeTranslation: RICH_NATIVE_TRANSLATION,
          nativeMeaning: RICH_NATIVE_MEANING,
          otherTranslation: RICH_OTHER_TRANSLATION,
        }
      : {}),
  };
}

/**
 * Provision an onboarded user in translate mode (interface/native English,
 * learning Czech) and return its domain id. Used by the translate happy-path and
 * callback-regression e2e tests, which all need a user the translate flow will
 * route to.
 *
 * The user lands on the seeded default plan (`free`), which is translation-only
 * since Task 79 — pass `plan` when the scenario needs a card feature a Free user
 * cannot use (e.g. `"pro"` for word audio).
 */
export async function arrangeOnboardedTranslator(
  telegramId: number,
  langs: { nativeLang?: string; learningLangs?: string[]; plan?: string } = {},
): Promise<number> {
  const { nativeLang = "en", learningLangs = ["cs"], plan } = langs;
  const user = await userRepository.create({ telegramId, username: "translator" });
  await userRepository.markOnboarded(user.id);
  await userRepository.updateSettings(user.id, {
    interfaceLang: "en",
    nativeLang,
    learningLangs,
    lastSourceLang: null,
  });
  await userRepository.updateActiveMode(user.id, "translate");
  if (plan) {
    await userRepository.updateSubscriptionPlan(user.id, plan);
  }
  return user.id;
}

/** Days of silence that put a user well past the inactivity threshold. */
export const LAPSED_DAYS = 20;

export interface LapsedUserOptions {
  /** Re-engagement cards already sent in the current episode. Defaults to none. */
  pingsAlreadySent?: number;
  /** Seed a saved word so the dictionary layer answers before the presets. Defaults to false. */
  withVocabulary?: boolean;
}

export interface LapsedUser {
  userId: number;
  telegramId: number;
  /** The seeded entry's headword — only meaningful under `withVocabulary`. */
  headword: string;
}

/**
 * Provision a subscriber who has gone quiet long enough to be due a
 * re-engagement card.
 *
 * The lapse columns are written directly because the only things that move them
 * in production are the passage of time and the sweep itself — there is no API
 * to drive, and adding a production setter for a test fixture would put a method
 * on the repository that nothing ships.
 *
 * `withVocabulary` decides which layer answers. It defaults to **false** because
 * an empty dictionary forces the curated preset set to supply the word, and that
 * is both the case the feature turns on and the population the previous design
 * served worst.
 *
 * Being lapsed also makes these users invisible to the delivery lane — they are
 * past the reachability ceiling, so `getUsersForWindow` cannot return them at any
 * hour and the two lanes need no slot arrangement between them.
 */
export async function arrangeLapsedUser(telegramId: number, options: LapsedUserOptions = {}): Promise<LapsedUser> {
  const { pingsAlreadySent = 0, withVocabulary = false } = options;
  const { userId, headword } = await arrangeNotifiableUser(telegramId, { withVocabulary });
  await setLapseState(userId, {
    lastInteractionAt: new Date(Date.now() - LAPSED_DAYS * DAY_MS),
    reengagementCount: pingsAlreadySent,
    // Far enough back that the spacing interval has certainly elapsed; NULL when
    // the episode has produced no card yet.
    lastReengagementAt: pingsAlreadySent > 0 ? new Date(Date.now() - 30 * DAY_MS) : null,
  });
  return { userId, telegramId, headword };
}

/**
 * Overwrite the lapse-tracking columns directly. See {@link arrangeLapsedUser}.
 *
 * `drizzle-orm` is not a dependency of `apps/bot` (only the adapter owns it) and
 * no repository method writes these columns to an arbitrary value — nothing in
 * production needs one — so the write goes through the driver the adapter
 * exposes, as `momentum-recording.integration.test.ts` does for the same reason.
 */
export async function setLapseState(
  userId: number,
  state: { lastInteractionAt?: Date; reengagementCount?: number; lastReengagementAt?: Date | null },
): Promise<void> {
  const sql = getDb().$client;
  // Timestamps go over the wire as ISO text with an explicit cast: the client is
  // the one drizzle configured, and it rejects a bare `Date` parameter.
  const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

  if (state.lastInteractionAt !== undefined) {
    await sql`update user_language_settings
              set last_interaction_at = ${iso(state.lastInteractionAt)}::timestamptz
              where user_id = ${userId}`;
  }
  if (state.reengagementCount !== undefined) {
    await sql`update user_language_settings
              set reengagement_count = ${state.reengagementCount}
              where user_id = ${userId}`;
  }
  if (state.lastReengagementAt !== undefined) {
    await sql`update user_language_settings
              set last_reengagement_at = ${iso(state.lastReengagementAt)}::timestamptz
              where user_id = ${userId}`;
  }
}

/**
 * Publish reviewed demo cards for every curated headword of a language pair,
 * and return those headwords.
 *
 * This is the preset layer's *free* path: `resolvePreset` reads the reviewed
 * demo-card cache first and only falls through to a just-in-time AI translation
 * when no reviewed card covers the pair. A lapse test that skips this seeding
 * does not fail loudly — the AI path is unavailable under the harness, so the
 * sweep quietly drops to its plain-text floor and the assertion reads as "the
 * preset layer is broken" when nothing is.
 *
 * Seeds the whole pool rather than a prefix: the picker walks a per-user
 * permutation of it, so "the first three" names no subset it will try first,
 * and a partial seed sends the JIT AI path a run of live calls before it
 * stumbles onto a cached pair.
 *
 * Rows are keyed by (sourceLang, nativeLang, headword) and shared across the
 * integration database, so the upsert is idempotent and safe to re-run. The
 * delivery lane closes its preset path outright (`pickPresetWord: async () =>
 * null`) unless a test opts back in, so seeding real pairs here cannot reach it
 * by accident.
 */
export async function arrangeCuratedPresets(sourceLang: string, nativeLang: string): Promise<string[]> {
  const headwords = getHookWords(sourceLang).map((hook) => hook.headword);

  for (const [index, headword] of headwords.entries()) {
    await onboardingDemoCardRepository.upsert({
      sourceLang,
      nativeLang,
      headword,
      sortOrder: index,
      payload: {
        original: headword,
        sourceLang,
        emoji: "✨",
        nativeMeaning: `curated meaning of ${headword}`,
        nativeSynonyms: [],
        translations: {
          [nativeLang]: { text: `translation of ${headword}`, synonyms: [], examples: [] },
        },
      },
    });
    // `upsert` writes the row unreviewed; only a reviewed card is ever served.
    await onboardingDemoCardRepository.setActive(sourceLang, nativeLang, headword, true);
  }

  return headwords;
}
