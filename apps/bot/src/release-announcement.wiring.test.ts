import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimNext: vi.fn(),
  finish: vi.fn(() => Promise.resolve()),
  announceNotes: vi.fn(() => Promise.resolve({ skipped: false, attempted: 2, delivered: 2, failed: 0 })),
}));

vi.mock("@polyglot/adapter-db", () => ({
  isAudienceGroup: (group: string) => ["admin", "tester", "product"].includes(group),
  releaseAnnouncementJobRepository: { claimNext: mocks.claimNext, finish: mocks.finish },
}));

vi.mock("./release-announcement.js", () => ({ announceNotes: mocks.announceNotes }));

const { runPendingAnnouncements } = await import("./release-announcement.wiring.js");

const messenger = { sendMessage: vi.fn() };

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    notes: [{ id: "abc123", texts: { en: "First change.", ru: "Первое изменение." } }],
    audienceGroups: ["admin", "tester"],
    ...overrides,
  };
}

describe("runPendingAnnouncements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when no announcement is queued", async () => {
    mocks.claimNext.mockResolvedValueOnce(null);

    await runPendingAnnouncements(messenger);

    expect(mocks.announceNotes).not.toHaveBeenCalled();
    expect(mocks.finish).not.toHaveBeenCalled();
  });

  it("sends a claimed job and records what it delivered", async () => {
    mocks.claimNext.mockResolvedValueOnce(job()).mockResolvedValueOnce(null);

    await runPendingAnnouncements(messenger);

    expect(mocks.announceNotes).toHaveBeenCalledWith(
      {
        notes: job().notes,
        audienceGroups: ["admin", "tester"],
        releaseId: "job:7",
      },
      messenger,
    );
    expect(mocks.finish).toHaveBeenCalledWith(7, "sent", { attempted: 2, delivered: 2, failed: 0 });
  });

  it("drains every queued job in one pass", async () => {
    mocks.claimNext
      .mockResolvedValueOnce(job({ id: 1 }))
      .mockResolvedValueOnce(job({ id: 2 }))
      .mockResolvedValueOnce(null);

    await runPendingAnnouncements(messenger);

    expect(mocks.finish).toHaveBeenCalledTimes(2);
  });

  it("marks a failed send failed instead of leaving the job claimed forever", async () => {
    mocks.claimNext.mockResolvedValueOnce(job()).mockResolvedValueOnce(null);
    mocks.announceNotes.mockRejectedValueOnce(new Error("telegram is down"));

    await runPendingAnnouncements(messenger);

    expect(mocks.finish).toHaveBeenCalledWith(7, "failed", { error: "telegram is down" });
  });

  it("drops an audience group the domain does not know", async () => {
    mocks.claimNext.mockResolvedValueOnce(job({ audienceGroups: ["tester", "nonsense"] })).mockResolvedValueOnce(null);

    await runPendingAnnouncements(messenger);

    expect(mocks.announceNotes).toHaveBeenCalledWith(
      expect.objectContaining({ audienceGroups: ["tester"] }),
      messenger,
    );
  });
});
