/**
 * Shared arrange helpers for the bot e2e integration lane (Task 71).
 */
import { getLang, notificationRepository, userRepository, vocabularyRepository } from "@polyglot/adapter-db";

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
