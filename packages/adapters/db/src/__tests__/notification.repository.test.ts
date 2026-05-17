import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock Temporal API (for Node < 26 environments) ──────────────

const ETC_GMT_OFFSETS: Record<string, number> = {
  "Etc/GMT": 0,
  "Etc/GMT-12": 12,
  "Etc/GMT-11": 11,
  "Etc/GMT-10": 10,
  "Etc/GMT-9": 9,
  "Etc/GMT-8": 8,
  "Etc/GMT-7": 7,
  "Etc/GMT-6": 6,
  "Etc/GMT-5": 5,
  "Etc/GMT-4": 4,
  "Etc/GMT-3": 3,
  "Etc/GMT-2": 2,
  "Etc/GMT-1": 1,
  "Etc/GMT+1": -1,
  "Etc/GMT+2": -2,
  "Etc/GMT+3": -3,
  "Etc/GMT+4": -4,
  "Etc/GMT+5": -5,
  "Etc/GMT+6": -6,
  "Etc/GMT+7": -7,
  "Etc/GMT+8": -8,
  "Etc/GMT+9": -9,
  "Etc/GMT+10": -10,
  "Etc/GMT+11": -11,
  "Etc/GMT+12": -12,
};

const IANA_OFFSETS: Record<string, number> = {
  UTC: 0,
  "Europe/Prague": 1,
  "Europe/London": 0,
  "Europe/Moscow": 3,
  "America/New_York": -5,
  "America/Chicago": -6,
  "America/Denver": -7,
  "America/Los_Angeles": -8,
  "Asia/Tokyo": 9,
  "Asia/Shanghai": 8,
  "Australia/Sydney": 11,
};

function getUtcOffsetHours(timezone: string): number {
  if (ETC_GMT_OFFSETS[timezone] !== undefined) return ETC_GMT_OFFSETS[timezone];
  if (IANA_OFFSETS[timezone] !== undefined) return IANA_OFFSETS[timezone];
  throw new Error(`Unknown timezone: ${timezone}`);
}

vi.stubGlobal("Temporal", {
  Instant: {
    from: (iso: string) => {
      const match = iso.match(/T(\d{2}):(\d{2}):(\d{2})Z/);
      if (!match) throw new Error(`Invalid instant: ${iso}`);
      return { hour: +match[1]!, minute: +match[2]!, second: +match[3]! };
    },
  },
});

(globalThis as any).Temporal.Instant.from = (iso: string) => {
  const match = iso.match(/T(\d{2}):(\d{2}):(\d{2})Z/);
  if (!match) throw new Error(`Invalid instant: ${iso}`);
  return {
    hour: +match[1]!,
    minute: +match[2]!,
    second: +match[3]!,
    toZonedDateTimeISO: (tz: string) => {
      const offset = getUtcOffsetHours(tz);
      let h = (+match[1]! + offset) % 24;
      if (h < 0) h += 24;
      return { hour: h, minute: +match[2]! };
    },
  };
};

// ── Configurable mock DB ────────────────────────────────────────

let queryResults: unknown[] = [];
let queryIndex = 0;
let lastUpdateSet: unknown = null;

function nextResult(): unknown {
  return queryResults[queryIndex++] ?? [];
}

function chainable(): Promise<unknown> {
  const self: Record<string, unknown> = {};
  const terminal = () => Promise.resolve(nextResult());

  self.from = vi.fn(() => self);
  self.innerJoin = vi.fn(() => self);
  self.where = vi.fn(() => self);
  self.orderBy = vi.fn(() => self);
  self.groupBy = vi.fn(() => self);
  self.limit = vi.fn(() => terminal());
  self.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => terminal().then(resolve, reject);

  return self as unknown as Promise<unknown>;
}

const mockDb = {
  select: vi.fn(() => chainable()),
  update: vi.fn(() => ({
    set: vi.fn((set: unknown) => {
      lastUpdateSet = set;
      const result = Promise.resolve();
      return { where: vi.fn(() => result) };
    }),
  })),
};

vi.mock("../connection.js", () => ({
  getDb: () => mockDb,
}));

const {
  notificationRepository,
  NOTIFICATION_TYPES,
  DEFAULT_NOTIFICATION_TIME,
  DEFAULT_NOTIFICATION_TYPE,
  INACTIVITY_DAYS,
  getLocalMinutes,
  parseNotificationMinutes,
  formatNotificationTime,
} = await import("../repositories/notification.repository.js");

beforeEach(() => {
  queryResults = [];
  queryIndex = 0;
  lastUpdateSet = null;
  vi.clearAllMocks();
  mockDb.select.mockImplementation(() => chainable());
  mockDb.update.mockImplementation(() => ({
    set: vi.fn((set: unknown) => {
      lastUpdateSet = set;
      const result = Promise.resolve();
      return { where: vi.fn(() => result) };
    }),
  }));
});

// ── Helpers ──────────────────────────────────────────────────────

function makeNotifUser(overrides: Record<string, unknown> = {}) {
  return {
    userId: 1,
    telegramId: 111111,
    interfaceLang: "en",
    nativeLang: "ru",
    learningLangs: ["cs", "de"],
    timezone: "UTC",
    notificationTime: "08:00",
    notificationType: "both",
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe("domain constants", () => {
  it("NOTIFICATION_TYPES contains valid type strategies", () => {
    expect(NOTIFICATION_TYPES).toEqual(["suggested", "srs", "both"]);
  });

  it("DEFAULT_NOTIFICATION_TIME is 08:00", () => {
    expect(DEFAULT_NOTIFICATION_TIME).toBe("08:00");
  });

  it("DEFAULT_NOTIFICATION_TYPE is both", () => {
    expect(DEFAULT_NOTIFICATION_TYPE).toBe("both");
  });

  it("INACTIVITY_DAYS is 14", () => {
    expect(INACTIVITY_DAYS).toBe(14);
  });
});

describe("parseNotificationMinutes", () => {
  it("parses HH:MM strings", () => {
    expect(parseNotificationMinutes("00:00")).toBe(0);
    expect(parseNotificationMinutes("08:00")).toBe(480);
    expect(parseNotificationMinutes("14:30")).toBe(870);
    expect(parseNotificationMinutes("23:30")).toBe(1410);
  });

  it("returns default for null/undefined", () => {
    const expected = 8 * 60; // 08:00
    expect(parseNotificationMinutes(null)).toBe(expected);
    expect(parseNotificationMinutes(undefined)).toBe(expected);
  });

  it("returns default for invalid values", () => {
    const expected = 8 * 60;
    expect(parseNotificationMinutes("morning")).toBe(expected);
    expect(parseNotificationMinutes("abc")).toBe(expected);
    expect(parseNotificationMinutes("")).toBe(expected);
    expect(parseNotificationMinutes("25:00")).toBe(expected);
  });
});

describe("formatNotificationTime", () => {
  it("formats minutes as HH:MM", () => {
    expect(formatNotificationTime(0)).toBe("00:00");
    expect(formatNotificationTime(480)).toBe("08:00");
    expect(formatNotificationTime(510)).toBe("08:30");
    expect(formatNotificationTime(870)).toBe("14:30");
    expect(formatNotificationTime(1200)).toBe("20:00");
    expect(formatNotificationTime(1410)).toBe("23:30");
  });
});

describe("getLocalMinutes", () => {
  it("returns correct minutes for UTC timezone", () => {
    expect(getLocalMinutes("UTC", 8, 0)).toBe(8 * 60);
    expect(getLocalMinutes("UTC", 0, 0)).toBe(0);
    expect(getLocalMinutes("UTC", 23, 30)).toBe(23 * 60 + 30);
  });

  it("returns -1 for invalid timezone", () => {
    expect(getLocalMinutes("Invalid/Timezone", 8, 0)).toBe(-1);
  });

  it("handles timezone offsets correctly", () => {
    // Etc/GMT-5 means UTC+5 (POSIX sign inversion)
    const result = getLocalMinutes("Etc/GMT-5", 3, 0);
    expect(result).toBe(8 * 60); // UTC 03:00 + 5h = 08:00
  });

  it("handles negative timezone offsets", () => {
    // Etc/GMT+5 means UTC-5 (POSIX sign inversion)
    const result = getLocalMinutes("Etc/GMT+5", 13, 0);
    expect(result).toBe(8 * 60); // UTC 13:00 - 5h = 08:00
  });

  it("handles midnight wrap-around", () => {
    // UTC 22:00, timezone UTC+5 → local 03:00 next day
    const result = getLocalMinutes("Etc/GMT-5", 22, 0);
    expect(result).toBe(3 * 60);
  });
});

describe("notificationRepository", () => {
  describe("getUsersForWindow", () => {
    it("returns users when UTC time matches their preferred local time", async () => {
      const user = makeNotifUser({ timezone: "UTC", notificationTime: "08:00" });
      queryResults = [[user]];

      const result = await notificationRepository.getUsersForWindow(8, 0);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(user);
    });

    it("returns users with custom time (e.g. 14:30)", async () => {
      const user = makeNotifUser({ timezone: "UTC", notificationTime: "14:30" });
      queryResults = [[user]];

      const result = await notificationRepository.getUsersForWindow(14, 30);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(user);
    });

    it("excludes users whose local time does not match", async () => {
      const user = makeNotifUser({ timezone: "UTC", notificationTime: "08:00" });
      queryResults = [[user]];

      const result = await notificationRepository.getUsersForWindow(10, 0);

      expect(result).toHaveLength(0);
    });

    it("handles timezone offset filtering", async () => {
      // User in UTC+5: when UTC hour = 3, their local time = 08:00
      const user = makeNotifUser({ timezone: "Etc/GMT-5", notificationTime: "08:00" });
      queryResults = [[user]];

      const result = await notificationRepository.getUsersForWindow(3, 0);

      expect(result).toHaveLength(1);
    });

    it("excludes users with invalid timezone", async () => {
      const user = makeNotifUser({ timezone: "Invalid/Tz" });
      queryResults = [[user]];

      const result = await notificationRepository.getUsersForWindow(8, 0);

      expect(result).toHaveLength(0);
    });

    it("returns empty array when no users are enabled", async () => {
      queryResults = [[]];

      const result = await notificationRepository.getUsersForWindow(8, 0);

      expect(result).toEqual([]);
    });

    it("filters mixed users correctly", async () => {
      const utcAt8 = makeNotifUser({ userId: 1, timezone: "UTC", notificationTime: "08:00" });
      const utcAt20 = makeNotifUser({ userId: 2, telegramId: 222, timezone: "UTC", notificationTime: "20:00" });
      const offsetAt8 = makeNotifUser({
        userId: 3,
        telegramId: 333,
        timezone: "Etc/GMT-5",
        notificationTime: "08:00",
      });
      queryResults = [[utcAt8, utcAt20, offsetAt8]];

      // UTC hour 8: UTC user at 08:00 matches, UTC at 20:00 doesn't, offset at 08:00 doesn't (local=13:00)
      const result = await notificationRepository.getUsersForWindow(8, 0);

      expect(result).toHaveLength(1);
      expect(result[0]!.userId).toBe(1);
    });

    it("calls select with innerJoin", async () => {
      queryResults = [[]];

      await notificationRepository.getUsersForWindow(8, 0);

      expect(mockDb.select).toHaveBeenCalledOnce();
    });
  });

  describe("getInactiveUsers", () => {
    it("returns inactive users from DB", async () => {
      const user = makeNotifUser();
      queryResults = [[user]];

      const result = await notificationRepository.getInactiveUsers();

      expect(result).toEqual([user]);
      expect(mockDb.select).toHaveBeenCalledOnce();
    });

    it("returns empty array when no inactive users exist", async () => {
      queryResults = [[]];

      const result = await notificationRepository.getInactiveUsers();

      expect(result).toEqual([]);
    });
  });

  describe("disableNotifications", () => {
    it("updates notificationEnabled to false", async () => {
      await notificationRepository.disableNotifications(42);

      expect(mockDb.update).toHaveBeenCalledOnce();
      expect(lastUpdateSet).toHaveProperty("notificationEnabled", false);
      expect(lastUpdateSet).toHaveProperty("updatedAt");
    });

    it("sets updatedAt timestamp", async () => {
      const before = new Date();

      await notificationRepository.disableNotifications(1);

      const after = new Date();
      const updatedAt = (lastUpdateSet as Record<string, unknown>).updatedAt as Date;
      expect(updatedAt).toBeInstanceOf(Date);
      expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("only sets notificationEnabled and updatedAt", async () => {
      await notificationRepository.disableNotifications(1);

      const setKeys = Object.keys(lastUpdateSet as object);
      expect(setKeys).toContain("notificationEnabled");
      expect(setKeys).toContain("updatedAt");
      expect(setKeys).toHaveLength(2);
    });
  });
});
