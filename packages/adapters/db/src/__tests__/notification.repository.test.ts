import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Configurable mock DB ────────────────────────────────────────

let queryResults: unknown[] = [];
let queryIndex = 0;
let lastUpdateSet: unknown = null;

function nextResult(): unknown {
  return queryResults[queryIndex++] ?? [];
}

/**
 * Chainable mock supporting: .from().innerJoin().where() → terminal
 * Also supports .update().set().where() chain
 */
function chainable(): unknown {
  const self: Record<string, unknown> = {};
  const terminal = () => Promise.resolve(nextResult());

  self.from = vi.fn(() => self);
  self.innerJoin = vi.fn(() => self);
  self.where = vi.fn(() => self);
  self.orderBy = vi.fn(() => self);
  self.groupBy = vi.fn(() => self);
  self.limit = vi.fn(() => terminal());
  // biome-ignore lint/suspicious/noThenProperty: mock needs .then for async chain resolution
  self.then = (resolve: (v: unknown) => void) => terminal().then(resolve);

  return self;
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
  DEFAULT_NOTIFICATION_HOUR,
  DEFAULT_NOTIFICATION_TYPE,
  MIN_NOTIFICATION_HOUR,
  MAX_NOTIFICATION_HOUR,
  INACTIVITY_DAYS,
  getLocalHour,
  parseNotificationHour,
  formatNotificationHour,
} = await import("../repositories/notification.repository.js");

beforeEach(() => {
  queryResults = [];
  queryIndex = 0;
  lastUpdateSet = null;
  vi.clearAllMocks();
  // Re-apply default implementations after clearAllMocks
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
    notificationTime: "8",
    notificationType: "both",
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe("domain constants", () => {
  it("NOTIFICATION_TYPES contains valid type strategies", () => {
    expect(NOTIFICATION_TYPES).toEqual(["suggested", "srs", "both"]);
  });

  it("DEFAULT_NOTIFICATION_HOUR is 8", () => {
    expect(DEFAULT_NOTIFICATION_HOUR).toBe(8);
  });

  it("DEFAULT_NOTIFICATION_TYPE is both", () => {
    expect(DEFAULT_NOTIFICATION_TYPE).toBe("both");
  });

  it("MIN_NOTIFICATION_HOUR is 0", () => {
    expect(MIN_NOTIFICATION_HOUR).toBe(0);
  });

  it("MAX_NOTIFICATION_HOUR is 23", () => {
    expect(MAX_NOTIFICATION_HOUR).toBe(23);
  });

  it("INACTIVITY_DAYS is 14", () => {
    expect(INACTIVITY_DAYS).toBe(14);
  });
});

describe("parseNotificationHour", () => {
  it("parses valid hour strings", () => {
    expect(parseNotificationHour("0")).toBe(0);
    expect(parseNotificationHour("8")).toBe(8);
    expect(parseNotificationHour("14")).toBe(14);
    expect(parseNotificationHour("23")).toBe(23);
  });

  it("returns default for null/undefined", () => {
    expect(parseNotificationHour(null)).toBe(DEFAULT_NOTIFICATION_HOUR);
    expect(parseNotificationHour(undefined)).toBe(DEFAULT_NOTIFICATION_HOUR);
  });

  it("returns default for invalid values", () => {
    expect(parseNotificationHour("morning")).toBe(DEFAULT_NOTIFICATION_HOUR);
    expect(parseNotificationHour("abc")).toBe(DEFAULT_NOTIFICATION_HOUR);
    expect(parseNotificationHour("-1")).toBe(DEFAULT_NOTIFICATION_HOUR);
    expect(parseNotificationHour("24")).toBe(DEFAULT_NOTIFICATION_HOUR);
    expect(parseNotificationHour("99")).toBe(DEFAULT_NOTIFICATION_HOUR);
  });
});

describe("formatNotificationHour", () => {
  it("formats single-digit hours with leading zero", () => {
    expect(formatNotificationHour(0)).toBe("00:00");
    expect(formatNotificationHour(8)).toBe("08:00");
    expect(formatNotificationHour(9)).toBe("09:00");
  });

  it("formats double-digit hours", () => {
    expect(formatNotificationHour(14)).toBe("14:00");
    expect(formatNotificationHour(20)).toBe("20:00");
    expect(formatNotificationHour(23)).toBe("23:00");
  });
});

describe("getLocalHour", () => {
  it("returns correct hour for UTC timezone", () => {
    expect(getLocalHour("UTC", 8)).toBe(8);
    expect(getLocalHour("UTC", 0)).toBe(0);
    expect(getLocalHour("UTC", 23)).toBe(23);
  });

  it("returns -1 for invalid timezone", () => {
    expect(getLocalHour("Invalid/Timezone", 8)).toBe(-1);
  });

  it("handles timezone offsets correctly", () => {
    // Etc/GMT-5 means UTC+5 (POSIX sign inversion)
    const result = getLocalHour("Etc/GMT-5", 3);
    expect(result).toBe(8); // UTC 03:00 + 5h = 08:00
  });

  it("handles negative timezone offsets", () => {
    // Etc/GMT+5 means UTC-5 (POSIX sign inversion)
    const result = getLocalHour("Etc/GMT+5", 13);
    expect(result).toBe(8); // UTC 13:00 - 5h = 08:00
  });

  it("handles midnight wrap-around", () => {
    // UTC 22:00, timezone UTC+5 → local 03:00 next day
    const result = getLocalHour("Etc/GMT-5", 22);
    expect(result).toBe(3);
  });
});

describe("notificationRepository", () => {
  describe("getUsersForWindow", () => {
    it("returns users when UTC hour matches their preferred local hour", async () => {
      const user = makeNotifUser({ timezone: "UTC", notificationTime: "8" });
      queryResults = [[user]];

      const result = await notificationRepository.getUsersForWindow(8);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(user);
    });

    it("returns users with custom hour (e.g. 14:00)", async () => {
      const user = makeNotifUser({ timezone: "UTC", notificationTime: "14" });
      queryResults = [[user]];

      const result = await notificationRepository.getUsersForWindow(14);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(user);
    });

    it("excludes users whose local hour does not match", async () => {
      const user = makeNotifUser({ timezone: "UTC", notificationTime: "8" });
      queryResults = [[user]];

      // UTC hour 10 → local hour 10 for UTC user, but user wants 8
      const result = await notificationRepository.getUsersForWindow(10);

      expect(result).toHaveLength(0);
    });

    it("handles timezone offset filtering", async () => {
      // User in UTC+5: when UTC hour = 3, their local hour = 8
      const user = makeNotifUser({ timezone: "Etc/GMT-5", notificationTime: "8" });
      queryResults = [[user]];

      const result = await notificationRepository.getUsersForWindow(3);

      expect(result).toHaveLength(1);
    });

    it("excludes users with invalid timezone", async () => {
      const user = makeNotifUser({ timezone: "Invalid/Tz" });
      queryResults = [[user]];

      const result = await notificationRepository.getUsersForWindow(8);

      expect(result).toHaveLength(0);
    });

    it("returns empty array when no users are enabled", async () => {
      queryResults = [[]];

      const result = await notificationRepository.getUsersForWindow(8);

      expect(result).toEqual([]);
    });

    it("filters mixed users correctly", async () => {
      const utcAt8 = makeNotifUser({ userId: 1, timezone: "UTC", notificationTime: "8" });
      const utcAt20 = makeNotifUser({ userId: 2, telegramId: 222, timezone: "UTC", notificationTime: "20" });
      const offsetAt8 = makeNotifUser({
        userId: 3,
        telegramId: 333,
        timezone: "Etc/GMT-5",
        notificationTime: "8",
      });
      queryResults = [[utcAt8, utcAt20, offsetAt8]];

      // UTC hour 8: UTC user at 8 matches (8=8), UTC at 20 doesn't (8≠20), offset at 8 doesn't (8+5=13≠8)
      const result = await notificationRepository.getUsersForWindow(8);

      expect(result).toHaveLength(1);
      expect(result[0]!.userId).toBe(1);
    });

    it("calls select with innerJoin", async () => {
      queryResults = [[]];

      await notificationRepository.getUsersForWindow(8);

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
