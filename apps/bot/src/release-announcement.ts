import {
  AUDIENCE_GROUPS,
  identityRepository,
  isAudienceGroup,
  notificationDeliveryRepository,
  type RecordNotificationDeliveryInput,
  userRepository,
} from "@polyglot/adapter-db";
import type { AudienceGroup, SupportedLang, TranslatedReleaseNote, User } from "@polyglot/core";
import {
  buildAnnouncementText,
  findUnreleasedDir,
  isSupported,
  logger,
  readTranslatedNotes,
  t,
  textForReader,
} from "@polyglot/core";
import { logDelivery } from "./notifications/delivery-log.js";

export interface ReleaseAnnouncementEnv {
  RELEASE_ID?: string;
  RELEASE_AUDIENCE_GROUPS?: string;
  /** Override for tests; a container reads the queue baked into its image. */
  RELEASE_NOTES_DIR?: string;
}

export interface TelegramMessenger {
  sendMessage(
    chatId: number,
    text: string,
    options?: {
      parse_mode: "HTML";
      disable_web_page_preview: boolean;
    },
  ): Promise<{ message_id: number }>;
}

/** The two languages a note may be read in, before English. */
export interface ReaderLangs {
  interfaceLang: string;
  nativeLang: string;
}

export interface ReleaseAnnouncementRepository {
  listActiveByAudienceGroups(audienceGroups: AudienceGroup[]): Promise<User[]>;
  hasReleaseAnnouncementDelivery(releaseId: string, audienceGroup: AudienceGroup, userId: number): Promise<boolean>;
  recordReleaseAnnouncementDelivery(releaseId: string, audienceGroup: AudienceGroup, userId: number): Promise<void>;
  /** Resolve the channel external id (Telegram chat id) for a neutral userId (Fable T24/A1). */
  findExternalId(userId: number, channel: string): Promise<string | null>;
  recordNotificationDelivery(input: RecordNotificationDeliveryInput): Promise<void>;
  getReaderLangs(userId: number): Promise<ReaderLangs | null>;
}

/**
 * Default repository composing user provisioning (userRepository) with channel
 * identity resolution (identityRepository) — the domain `User` no longer carries
 * a telegramId, so the Telegram chat id is resolved through the identity port.
 */
const defaultRepository: ReleaseAnnouncementRepository = {
  listActiveByAudienceGroups: (audienceGroups) => userRepository.listActiveByAudienceGroups(audienceGroups),
  hasReleaseAnnouncementDelivery: (releaseId, audienceGroup, userId) =>
    userRepository.hasReleaseAnnouncementDelivery(releaseId, audienceGroup, userId),
  recordReleaseAnnouncementDelivery: (releaseId, audienceGroup, userId) =>
    userRepository.recordReleaseAnnouncementDelivery(releaseId, audienceGroup, userId),
  findExternalId: (userId, channel) => identityRepository.findExternalId(userId, channel),
  recordNotificationDelivery: (input) => notificationDeliveryRepository.record(input),
  getReaderLangs: async (userId) => {
    const settings = await userRepository.getSettings(userId);
    return settings ? { interfaceLang: settings.interfaceLang, nativeLang: settings.nativeLang } : null;
  },
};

export interface ReleaseAnnouncementResult {
  skipped: boolean;
  attempted: number;
  delivered: number;
  failed: number;
}

export interface AnnounceNotesOptions {
  notes: readonly TranslatedReleaseNote[];
  audienceGroups: AudienceGroup[];
  /** Recorded on each journal row so a delivery can be traced to the send that made it. */
  releaseId: string;
}

const DEFAULT_AUDIENCE_GROUPS: readonly AudienceGroup[] = ["admin", "tester"];

/**
 * Dedup key: one row per note per reader, not per send. Sending the same queue
 * twice — first to testers, then to everyone — repeats nothing for the people
 * who already read it.
 */
function noteDeliveryKey(noteId: string): string {
  return `note:${noteId}`;
}

function parseAudienceGroups(value: string | undefined): AudienceGroup[] {
  if (!value) return [...DEFAULT_AUDIENCE_GROUPS];

  const groups = value
    .split(",")
    .map((group) => group.trim())
    .filter((group) => group.length > 0);

  const invalid = groups.find((group) => !isAudienceGroup(group));
  if (invalid) {
    throw new Error(`Invalid release audience group: ${invalid}. Allowed: ${AUDIENCE_GROUPS.join(", ")}`);
  }

  return groups as AudienceGroup[];
}

/**
 * Send the given notes to everyone in the given groups, in each reader's own
 * language, skipping what they already received.
 */
export async function announceNotes(
  options: AnnounceNotesOptions,
  messenger: TelegramMessenger,
  repository: ReleaseAnnouncementRepository = defaultRepository,
): Promise<ReleaseAnnouncementResult> {
  const { notes, audienceGroups, releaseId } = options;

  if (notes.length === 0 || audienceGroups.length === 0) {
    logger.info({ releaseId }, "Nothing to announce");
    return { skipped: true, attempted: 0, delivered: 0, failed: 0 };
  }

  const users = await repository.listActiveByAudienceGroups(audienceGroups);
  let attempted = 0;
  let delivered = 0;
  let failed = 0;

  for (const user of users) {
    const langs = await repository.getReaderLangs(user.id);
    const readerLangs = [langs?.interfaceLang, langs?.nativeLang];

    const pending = [];
    for (const note of notes) {
      const already = await repository.hasReleaseAnnouncementDelivery(
        noteDeliveryKey(note.id),
        user.audienceGroup,
        user.id,
      );
      if (!already) pending.push({ id: note.id, text: textForReader(note, readerLangs) });
    }

    if (pending.length === 0) {
      logger.info({ releaseId, userId: user.id }, "No release notes pending for user");
      continue;
    }

    const externalId = await repository.findExternalId(user.id, "telegram");
    if (!externalId) {
      logger.warn({ releaseId, userId: user.id }, "No telegram identity for user — skipping announcement");
      continue;
    }

    const headerLang: SupportedLang =
      readerLangs.find((lang): lang is SupportedLang => !!lang && isSupported(lang)) ?? "en";
    const { text, included } = buildAnnouncementText(t("releaseNotesHeader", headerLang), pending);

    attempted += 1;
    try {
      const sent = await messenger.sendMessage(Number(externalId), text, {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      await logDelivery(
        { record: (input) => repository.recordNotificationDelivery(input) },
        {
          userId: user.id,
          kind: "release_announcement",
          text,
          parseMode: "HTML",
          meta: { releaseId, noteIds: included.map((note) => note.id).join(",") },
          telegramMessageId: sent.message_id,
        },
      );
      // Only what the message actually carried: a note pushed out by Telegram's
      // length limit must stay pending rather than be recorded as read.
      for (const note of included) {
        await repository.recordReleaseAnnouncementDelivery(noteDeliveryKey(note.id), user.audienceGroup, user.id);
      }
      delivered += 1;
    } catch (err) {
      failed += 1;
      logger.error(
        { err, releaseId, userId: user.id, audienceGroup: user.audienceGroup },
        "Release announcement failed",
      );
    }
  }

  logger.info({ releaseId, audienceGroups, attempted, delivered, failed }, "Release announcement finished");
  return { skipped: false, attempted, delivered, failed };
}

/**
 * The whole pending queue, straight from the image — the command-line path, kept
 * for a send from a shell when the panel is not an option.
 */
export async function sendReleaseAnnouncement(
  env: ReleaseAnnouncementEnv,
  messenger: TelegramMessenger,
  repository: ReleaseAnnouncementRepository = defaultRepository,
): Promise<ReleaseAnnouncementResult> {
  const releaseId = env.RELEASE_ID?.trim();
  if (!releaseId) {
    throw new Error("RELEASE_ID is required");
  }

  const notesDir = env.RELEASE_NOTES_DIR?.trim() || findUnreleasedDir();
  if (!notesDir) {
    logger.warn({ releaseId }, "Release notes directory not found");
    return { skipped: true, attempted: 0, delivered: 0, failed: 0 };
  }

  return announceNotes(
    {
      notes: readTranslatedNotes(notesDir),
      audienceGroups: parseAudienceGroups(env.RELEASE_AUDIENCE_GROUPS),
      releaseId,
    },
    messenger,
    repository,
  );
}
