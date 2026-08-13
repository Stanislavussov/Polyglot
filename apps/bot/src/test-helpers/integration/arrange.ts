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

export interface NotifiableUserOptions {
  /** Configured slots, as `HH:MM`. Defaults to the delivery lane's own slot. */
  notificationTimes?: string[];
  /** Defaults to true. */
  notificationEnabled?: boolean;
  /** Seed a verified vocabulary entry with one resolvable translation. Defaults to true. */
  withVocabulary?: boolean;
  /** Headword of the seeded entry. Defaults to "bridge". */
  headword?: string;
}

export interface NotifiableUser {
  userId: number;
  telegramId: number;
  headword: string;
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
    headword = "bridge",
  } = options;

  const user = await userRepository.create({ telegramId, username: "notifiable" });
  await userRepository.markOnboarded(user.id);
  await userRepository.updateSettings(user.id, {
    interfaceLang: "en",
    nativeLang: "en",
    learningLangs: ["cs"],
    lastSourceLang: null,
  });

  // `timezone` defaults to "UTC" and `is_active` to true (schema.ts), and a NULL
  // `last_interaction_at` is explicitly eligible in `getUsersForWindow` — so the
  // schedule is the only thing this fixture has to state.
  await notificationRepository.updatePrefs(user.id, { notificationEnabled, notificationTimes });

  if (withVocabulary) {
    const sourceLang = getLang("en");
    const targetLang = getLang("cs");
    if (!sourceLang || !targetLang) {
      throw new Error("arrangeNotifiableUser: language cache is not loaded (en/cs missing)");
    }
    await vocabularyRepository.create(user.id, {
      original: headword,
      sourceLangId: sourceLang.id,
      inputType: "word",
      emoji: "🌉",
      unverified: false,
      translations: [{ targetLangId: targetLang.id, text: "most", details: { synonyms: [], examples: [] } }],
    });
  }

  return { userId: user.id, telegramId, headword };
}

/**
 * Disable this test's own user so the row stops being eligible for every later
 * file in the shared integration database. Per-test teardown, not truncation.
 */
export async function disableNotificationsFor(userId: number): Promise<void> {
  await notificationRepository.disableNotifications(userId);
}

/**
 * Provision an onboarded user in translate mode (interface/native English,
 * learning Czech) and return its domain id. Used by the translate happy-path and
 * callback-regression e2e tests, which all need a user the translate flow will
 * route to.
 */
export async function arrangeOnboardedTranslator(telegramId: number): Promise<number> {
  const user = await userRepository.create({ telegramId, username: "translator" });
  await userRepository.markOnboarded(user.id);
  await userRepository.updateSettings(user.id, {
    interfaceLang: "en",
    nativeLang: "en",
    learningLangs: ["cs"],
    lastSourceLang: null,
  });
  await userRepository.updateActiveMode(user.id, "translate");
  return user.id;
}
