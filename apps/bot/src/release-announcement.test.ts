import type { User } from "@polyglot/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ReleaseAnnouncementRepository,
  sendReleaseAnnouncement,
  type TelegramMessenger,
} from "./release-announcement.js";

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
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
 * @param externalIds map of userId → Telegram chat id string (identity resolution).
 * Users without an entry resolve to `null` and are skipped by the announcement.
 */
function makeRepository(
  users: User[],
  deliveredUserIds: readonly number[] = [],
  externalIds: Record<number, string> = {},
): ReleaseAnnouncementRepository {
  return {
    listActiveByAudienceGroups: vi.fn<ReleaseAnnouncementRepository["listActiveByAudienceGroups"]>((audienceGroups) =>
      Promise.resolve(users.filter((user) => audienceGroups.includes(user.audienceGroup))),
    ),
    hasReleaseAnnouncementDelivery: vi.fn<ReleaseAnnouncementRepository["hasReleaseAnnouncementDelivery"]>(
      (_releaseId, _group, userId) => Promise.resolve(deliveredUserIds.includes(userId)),
    ),
    recordReleaseAnnouncementDelivery: vi.fn<ReleaseAnnouncementRepository["recordReleaseAnnouncementDelivery"]>(() =>
      Promise.resolve(),
    ),
    findExternalId: vi.fn<ReleaseAnnouncementRepository["findExternalId"]>((userId) =>
      Promise.resolve(externalIds[userId] ?? null),
    ),
  };
}

function makeMessenger(): TelegramMessenger {
  return {
    sendMessage: vi.fn<TelegramMessenger["sendMessage"]>(() => Promise.resolve({ ok: true })),
  };
}

describe("sendReleaseAnnouncement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips empty changelog messages", async () => {
    const repository = makeRepository([makeUser({})]);
    const messenger = makeMessenger();

    const result = await sendReleaseAnnouncement(
      { RELEASE_ID: "release-1", RELEASE_ANNOUNCEMENT_BASE64: "" },
      messenger,
      repository,
    );

    expect(result).toEqual({ skipped: true, attempted: 0, delivered: 0, failed: 0 });
    expect(repository.listActiveByAudienceGroups).not.toHaveBeenCalled();
    expect(messenger.sendMessage).not.toHaveBeenCalled();
  });

  it("sends only active admin and tester users from the configured groups", async () => {
    const admin = makeUser({ id: 1, audienceGroup: "admin" });
    const tester = makeUser({ id: 2, audienceGroup: "tester" });
    const product = makeUser({ id: 3, audienceGroup: "product" });
    const repository = makeRepository([admin, tester, product], [], { 1: "111", 2: "222", 3: "333" });
    const messenger = makeMessenger();

    const result = await sendReleaseAnnouncement(
      {
        RELEASE_ID: "release-1",
        RELEASE_AUDIENCE_GROUPS: "admin,tester",
        RELEASE_ANNOUNCEMENT_BASE64: encode("### Added\n\n- <new feature> & rollout"),
      },
      messenger,
      repository,
    );

    expect(result).toEqual({ skipped: false, attempted: 2, delivered: 2, failed: 0 });
    expect(repository.listActiveByAudienceGroups).toHaveBeenCalledWith(["admin", "tester"]);
    expect(messenger.sendMessage).toHaveBeenCalledTimes(2);
    expect(messenger.sendMessage).toHaveBeenCalledWith(
      111,
      expect.stringContaining("&lt;new feature&gt; &amp; rollout"),
      { parse_mode: "HTML", disable_web_page_preview: true },
    );
    expect(messenger.sendMessage).not.toHaveBeenCalledWith(333, expect.any(String), expect.anything());
  });

  it("does not resend already recorded deliveries", async () => {
    const admin = makeUser({ id: 1, audienceGroup: "admin" });
    const tester = makeUser({ id: 2, audienceGroup: "tester" });
    const repository = makeRepository([admin, tester], [1], { 1: "111", 2: "222" });
    const messenger = makeMessenger();

    const result = await sendReleaseAnnouncement(
      { RELEASE_ID: "release-1", RELEASE_ANNOUNCEMENT_BASE64: encode("- shipped") },
      messenger,
      repository,
    );

    expect(result).toEqual({ skipped: false, attempted: 1, delivered: 1, failed: 0 });
    expect(messenger.sendMessage).toHaveBeenCalledOnce();
    expect(messenger.sendMessage).toHaveBeenCalledWith(222, expect.any(String), expect.anything());
    expect(repository.recordReleaseAnnouncementDelivery).toHaveBeenCalledWith("release-1", "tester", 2);
  });

  it("truncates an oversized message to Telegram's 4096-char limit without cutting an HTML entity", async () => {
    const tester = makeUser({ id: 1, audienceGroup: "tester" });
    const repository = makeRepository([tester], [], { 1: "111" });
    const messenger = makeMessenger();
    // A body made of "&" chars: every char escapes to the 5-char entity "&amp;",
    // so a naive slice at the char budget is very likely to land inside one.
    const oversized = "&".repeat(5000);

    const result = await sendReleaseAnnouncement(
      { RELEASE_ID: "release-1", RELEASE_ANNOUNCEMENT_BASE64: encode(oversized) },
      messenger,
      repository,
    );

    expect(result).toEqual({ skipped: false, attempted: 1, delivered: 1, failed: 0 });
    const sentText = vi.mocked(messenger.sendMessage).mock.calls[0]?.[1] ?? "";
    expect(sentText.length).toBeLessThanOrEqual(4096);
    expect(sentText.endsWith("…")).toBe(true);
    // No dangling partial entity: the content right before the ellipsis must not
    // end with a bare "&amp"/"&am"/"&" (an entity missing its closing ";").
    const beforeEllipsis = sentText.slice(0, -1);
    expect(beforeEllipsis).not.toMatch(/&[a-z]*$/);
  });

  it("continues when one Telegram send fails", async () => {
    const admin = makeUser({ id: 1, audienceGroup: "admin" });
    const tester = makeUser({ id: 2, audienceGroup: "tester" });
    const repository = makeRepository([admin, tester], [], { 1: "111", 2: "222" });
    const messenger = makeMessenger();
    vi.mocked(messenger.sendMessage).mockRejectedValueOnce(new Error("telegram failed"));

    const result = await sendReleaseAnnouncement(
      { RELEASE_ID: "release-1", RELEASE_ANNOUNCEMENT_BASE64: encode("- shipped") },
      messenger,
      repository,
    );

    expect(result).toEqual({ skipped: false, attempted: 2, delivered: 1, failed: 1 });
    expect(messenger.sendMessage).toHaveBeenCalledTimes(2);
    expect(repository.recordReleaseAnnouncementDelivery).toHaveBeenCalledOnce();
    expect(repository.recordReleaseAnnouncementDelivery).toHaveBeenCalledWith("release-1", "tester", 2);
  });
});
