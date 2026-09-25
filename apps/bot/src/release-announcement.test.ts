import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { noteId, type User } from "@polyglot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ReaderLangs,
  type ReleaseAnnouncementRepository,
  sendReleaseAnnouncement,
  type TelegramMessenger,
} from "./release-announcement.js";

const EN_FIRST = "First change.";
const EN_SECOND = "Second change.";

function notesDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "release-announcement-"));
  const content = {
    "en.md": `- ${EN_FIRST}\n- ${EN_SECOND}`,
    "ru.md": "- Первое изменение.\n- Второе изменение.",
    ...files,
  };
  for (const [name, text] of Object.entries(content)) {
    writeFileSync(join(dir, name), text, "utf8");
  }
  return dir;
}

function makeUser(overrides: Partial<User>): User {
  return {
    id: 1,
    username: "tester",
    audienceGroup: "tester",
    subscriptionPlan: "free",
    onboardingStep: 3,
    onboarded: true,
    isActive: true,
    createdAt: new Date("2026-06-14T00:00:00Z"),
    ...overrides,
  };
}

/**
 * @param deliveredKeys release ids already recorded for a user (`note:<id>`).
 * @param externalIds map of userId → Telegram chat id; a user missing here has
 * no identity and is skipped.
 */
function makeRepository(
  users: User[],
  options: {
    deliveredKeys?: Record<number, readonly string[]>;
    externalIds?: Record<number, string>;
    langs?: Record<number, ReaderLangs>;
  } = {},
): ReleaseAnnouncementRepository {
  const { deliveredKeys = {}, externalIds = { 1: "111", 2: "222", 3: "333" }, langs = {} } = options;

  return {
    listActiveByAudienceGroups: vi.fn<ReleaseAnnouncementRepository["listActiveByAudienceGroups"]>((audienceGroups) =>
      Promise.resolve(users.filter((user) => audienceGroups.includes(user.audienceGroup))),
    ),
    hasReleaseAnnouncementDelivery: vi.fn<ReleaseAnnouncementRepository["hasReleaseAnnouncementDelivery"]>(
      (releaseId, _group, userId) => Promise.resolve((deliveredKeys[userId] ?? []).includes(releaseId)),
    ),
    recordReleaseAnnouncementDelivery: vi.fn<ReleaseAnnouncementRepository["recordReleaseAnnouncementDelivery"]>(() =>
      Promise.resolve(),
    ),
    findExternalId: vi.fn<ReleaseAnnouncementRepository["findExternalId"]>((userId) =>
      Promise.resolve(externalIds[userId] ?? null),
    ),
    recordNotificationDelivery: vi.fn<ReleaseAnnouncementRepository["recordNotificationDelivery"]>(() =>
      Promise.resolve(),
    ),
    getReaderLangs: vi.fn<ReleaseAnnouncementRepository["getReaderLangs"]>((userId) =>
      Promise.resolve(langs[userId] ?? { interfaceLang: "en", nativeLang: "en" }),
    ),
  };
}

function makeMessenger(): TelegramMessenger {
  return {
    sendMessage: vi.fn<TelegramMessenger["sendMessage"]>(() => Promise.resolve({ message_id: 900 })),
  };
}

describe("sendReleaseAnnouncement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires a release id", async () => {
    await expect(sendReleaseAnnouncement({}, makeMessenger(), makeRepository([makeUser({})]))).rejects.toThrow(
      "RELEASE_ID is required",
    );
  });

  it("skips a release whose queue holds no notes", async () => {
    const repository = makeRepository([makeUser({})]);
    const messenger = makeMessenger();

    const result = await sendReleaseAnnouncement(
      { RELEASE_ID: "release-1", RELEASE_NOTES_DIR: notesDir({ "en.md": "# Unreleased — en\n", "ru.md": "" }) },
      messenger,
      repository,
    );

    expect(result).toEqual({ skipped: true, attempted: 0, delivered: 0, failed: 0 });
    expect(messenger.sendMessage).not.toHaveBeenCalled();
    expect(repository.listActiveByAudienceGroups).not.toHaveBeenCalled();
  });

  it("sends the notes to the configured groups only", async () => {
    const admin = makeUser({ id: 1, audienceGroup: "admin" });
    const tester = makeUser({ id: 2, audienceGroup: "tester" });
    const product = makeUser({ id: 3, audienceGroup: "product" });
    const repository = makeRepository([admin, tester, product]);
    const messenger = makeMessenger();

    const result = await sendReleaseAnnouncement(
      { RELEASE_ID: "release-1", RELEASE_AUDIENCE_GROUPS: "admin,tester", RELEASE_NOTES_DIR: notesDir() },
      messenger,
      repository,
    );

    expect(result).toEqual({ skipped: false, attempted: 2, delivered: 2, failed: 0 });
    expect(repository.listActiveByAudienceGroups).toHaveBeenCalledWith(["admin", "tester"]);
    expect(messenger.sendMessage).toHaveBeenCalledTimes(2);
    expect(messenger.sendMessage).toHaveBeenCalledWith(111, expect.stringContaining(`• ${EN_FIRST}`), {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    expect(messenger.sendMessage).not.toHaveBeenCalledWith(333, expect.any(String), expect.anything());
  });

  it("writes one delivery row per note, and journals which notes went", async () => {
    const tester = makeUser({ id: 2, audienceGroup: "tester" });
    const repository = makeRepository([tester]);
    const messenger = makeMessenger();

    await sendReleaseAnnouncement({ RELEASE_ID: "release-1", RELEASE_NOTES_DIR: notesDir() }, messenger, repository);

    expect(repository.recordReleaseAnnouncementDelivery).toHaveBeenCalledTimes(2);
    expect(repository.recordReleaseAnnouncementDelivery).toHaveBeenCalledWith(`note:${noteId(EN_FIRST)}`, "tester", 2);
    expect(repository.recordNotificationDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 2,
        kind: "release_announcement",
        parseMode: "HTML",
        meta: { releaseId: "release-1", noteIds: `${noteId(EN_FIRST)},${noteId(EN_SECOND)}` },
        telegramMessageId: 900,
      }),
    );
  });

  it("announces only the notes a reader has not been sent", async () => {
    const tester = makeUser({ id: 2, audienceGroup: "tester" });
    const repository = makeRepository([tester], { deliveredKeys: { 2: [`note:${noteId(EN_FIRST)}`] } });
    const messenger = makeMessenger();

    const result = await sendReleaseAnnouncement(
      { RELEASE_ID: "release-2", RELEASE_NOTES_DIR: notesDir() },
      messenger,
      repository,
    );

    expect(result).toEqual({ skipped: false, attempted: 1, delivered: 1, failed: 0 });
    const sent = vi.mocked(messenger.sendMessage).mock.calls[0]?.[1] ?? "";
    expect(sent).toContain(EN_SECOND);
    expect(sent).not.toContain(EN_FIRST);
    expect(repository.recordReleaseAnnouncementDelivery).toHaveBeenCalledOnce();
  });

  it("says nothing to a reader who has every note already", async () => {
    const tester = makeUser({ id: 2, audienceGroup: "tester" });
    const repository = makeRepository([tester], {
      deliveredKeys: { 2: [`note:${noteId(EN_FIRST)}`, `note:${noteId(EN_SECOND)}`] },
    });
    const messenger = makeMessenger();

    const result = await sendReleaseAnnouncement(
      { RELEASE_ID: "release-3", RELEASE_NOTES_DIR: notesDir() },
      messenger,
      repository,
    );

    expect(result).toEqual({ skipped: false, attempted: 0, delivered: 0, failed: 0 });
    expect(messenger.sendMessage).not.toHaveBeenCalled();
  });

  it("writes to a reader in their interface language, header included", async () => {
    const tester = makeUser({ id: 2, audienceGroup: "tester" });
    const repository = makeRepository([tester], { langs: { 2: { interfaceLang: "ru", nativeLang: "en" } } });
    const messenger = makeMessenger();

    await sendReleaseAnnouncement({ RELEASE_ID: "release-1", RELEASE_NOTES_DIR: notesDir() }, messenger, repository);

    const sent = vi.mocked(messenger.sendMessage).mock.calls[0]?.[1] ?? "";
    expect(sent).toContain("Что нового");
    expect(sent).toContain("• Первое изменение.");
    expect(sent).not.toContain(EN_FIRST);
  });

  it("falls back to the native language, then to English", async () => {
    const native = makeUser({ id: 1, audienceGroup: "admin" });
    const neither = makeUser({ id: 2, audienceGroup: "tester" });
    const repository = makeRepository([native, neither], {
      langs: {
        1: { interfaceLang: "de", nativeLang: "ru" },
        2: { interfaceLang: "de", nativeLang: "fr" },
      },
    });
    const messenger = makeMessenger();

    await sendReleaseAnnouncement({ RELEASE_ID: "release-1", RELEASE_NOTES_DIR: notesDir() }, messenger, repository);

    expect(messenger.sendMessage).toHaveBeenCalledWith(
      111,
      expect.stringContaining("Первое изменение."),
      expect.anything(),
    );
    expect(messenger.sendMessage).toHaveBeenCalledWith(222, expect.stringContaining(EN_FIRST), expect.anything());
  });

  it("skips a user with no telegram identity without recording anything", async () => {
    const tester = makeUser({ id: 2, audienceGroup: "tester" });
    const repository = makeRepository([tester], { externalIds: {} });
    const messenger = makeMessenger();

    const result = await sendReleaseAnnouncement(
      { RELEASE_ID: "release-1", RELEASE_NOTES_DIR: notesDir() },
      messenger,
      repository,
    );

    expect(result).toEqual({ skipped: false, attempted: 0, delivered: 0, failed: 0 });
    expect(repository.recordReleaseAnnouncementDelivery).not.toHaveBeenCalled();
  });

  it("leaves a failed send pending instead of recording it", async () => {
    const admin = makeUser({ id: 1, audienceGroup: "admin" });
    const tester = makeUser({ id: 2, audienceGroup: "tester" });
    const repository = makeRepository([admin, tester]);
    const messenger = makeMessenger();
    vi.mocked(messenger.sendMessage).mockRejectedValueOnce(new Error("telegram failed"));

    const result = await sendReleaseAnnouncement(
      { RELEASE_ID: "release-1", RELEASE_NOTES_DIR: notesDir() },
      messenger,
      repository,
    );

    expect(result).toEqual({ skipped: false, attempted: 2, delivered: 1, failed: 1 });
    // Only the second user's two notes were recorded.
    expect(repository.recordReleaseAnnouncementDelivery).toHaveBeenCalledTimes(2);
    expect(repository.recordReleaseAnnouncementDelivery).toHaveBeenCalledWith(`note:${noteId(EN_FIRST)}`, "tester", 2);
  });
});
