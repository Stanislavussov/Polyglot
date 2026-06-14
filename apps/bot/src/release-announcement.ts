import { AUDIENCE_GROUPS, isAudienceGroup, userRepository } from "@polyglot/adapter-db";
import type { AudienceGroup, User } from "@polyglot/core";
import { logger } from "@polyglot/core";

export interface ReleaseAnnouncementEnv {
  RELEASE_ID?: string;
  RELEASE_ANNOUNCEMENT_BASE64?: string;
  RELEASE_AUDIENCE_GROUPS?: string;
}

export interface TelegramMessenger {
  sendMessage(
    chatId: number,
    text: string,
    options?: {
      parse_mode: "HTML";
      disable_web_page_preview: boolean;
    },
  ): Promise<unknown>;
}

export interface ReleaseAnnouncementRepository {
  listActiveByAudienceGroups(audienceGroups: AudienceGroup[]): Promise<User[]>;
  hasReleaseAnnouncementDelivery(releaseId: string, audienceGroup: AudienceGroup, userId: number): Promise<boolean>;
  recordReleaseAnnouncementDelivery(releaseId: string, audienceGroup: AudienceGroup, userId: number): Promise<void>;
}

export interface ReleaseAnnouncementResult {
  skipped: boolean;
  attempted: number;
  delivered: number;
  failed: number;
}

const DEFAULT_AUDIENCE_GROUPS: readonly AudienceGroup[] = ["admin", "tester"];

function decodeAnnouncement(base64: string | undefined): string {
  if (!base64) return "";
  return Buffer.from(base64, "base64").toString("utf8").trim();
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

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function formatAnnouncementHtml(message: string): string {
  return `<b>Polyglot update</b>\n\n${escapeHtml(message)}`;
}

export async function sendReleaseAnnouncement(
  env: ReleaseAnnouncementEnv,
  messenger: TelegramMessenger,
  repository: ReleaseAnnouncementRepository = userRepository,
): Promise<ReleaseAnnouncementResult> {
  const releaseId = env.RELEASE_ID?.trim();
  if (!releaseId) {
    throw new Error("RELEASE_ID is required");
  }

  const message = decodeAnnouncement(env.RELEASE_ANNOUNCEMENT_BASE64);
  if (!message) {
    logger.info({ releaseId }, "No announcement content");
    return { skipped: true, attempted: 0, delivered: 0, failed: 0 };
  }

  const audienceGroups = parseAudienceGroups(env.RELEASE_AUDIENCE_GROUPS);
  if (audienceGroups.length === 0) {
    logger.info({ releaseId }, "No release audience groups configured");
    return { skipped: true, attempted: 0, delivered: 0, failed: 0 };
  }

  const users = await repository.listActiveByAudienceGroups(audienceGroups);
  let attempted = 0;
  let delivered = 0;
  let failed = 0;

  for (const user of users) {
    const alreadyDelivered = await repository.hasReleaseAnnouncementDelivery(releaseId, user.audienceGroup, user.id);
    if (alreadyDelivered) {
      logger.info(
        { releaseId, userId: user.id, audienceGroup: user.audienceGroup },
        "Release announcement already sent",
      );
      continue;
    }

    attempted += 1;
    try {
      await messenger.sendMessage(user.telegramId, formatAnnouncementHtml(message), {
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
      await repository.recordReleaseAnnouncementDelivery(releaseId, user.audienceGroup, user.id);
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
