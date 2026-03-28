import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock Drizzle query builder ──────────────────────────────────

const mockRows: unknown[] = [];
let lastInsertValues: unknown = null;
let lastUpdateSet: unknown = null;

const returningFn = vi.fn(() => Promise.resolve([...mockRows]));

const onConflictDoUpdateFn = vi.fn(() => ({ returning: returningFn }));

const insertValuesFn = vi.fn((values: unknown) => {
  lastInsertValues = values;
  return { onConflictDoUpdate: onConflictDoUpdateFn, returning: returningFn };
});

const insertFn = vi.fn(() => ({ values: insertValuesFn }));

const limitFn = vi.fn(() => Promise.resolve([...mockRows]));

const selectWhereFn = vi.fn(() => ({
  limit: limitFn,
}));

const selectFromFn = vi.fn(() => ({
  where: selectWhereFn,
}));

const selectFn = vi.fn(() => ({ from: selectFromFn }));

const updateReturningFn = vi.fn(() => Promise.resolve([...mockRows]));

const updateWhereFn = vi.fn(() => ({
  returning: updateReturningFn,
}));

const updateSetFn = vi.fn((set: unknown) => {
  lastUpdateSet = set;
  return { where: updateWhereFn };
});

const updateFn = vi.fn(() => ({ set: updateSetFn }));

const mockDb = {
  select: selectFn,
  insert: insertFn,
  update: updateFn,
};

vi.mock("../connection.js", () => ({
  getDb: () => mockDb,
}));

const { userRepository, MAX_LEARNING_LANGS } = await import("../repositories/user.repository.js");

beforeEach(() => {
  mockRows.length = 0;
  lastInsertValues = null;
  lastUpdateSet = null;
  vi.clearAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────────

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    telegramId: 123456,
    username: "testuser",
    onboardingStep: 0,
    onboarded: false,
    isActive: true,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeSettings(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 1,
    interfaceLang: "en",
    nativeLang: "ru",
    learningLangs: ["cs"],
    timezone: "UTC",
    activeMode: "translate",
    isActive: true,
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe("userRepository", () => {
  describe("findByTelegramId", () => {
    it("returns user when found", async () => {
      const user = makeUser();
      mockRows.push(user);

      const result = await userRepository.findByTelegramId(123456);

      expect(result).toEqual(user);
      expect(selectFn).toHaveBeenCalledOnce();
      expect(limitFn).toHaveBeenCalledWith(1);
    });

    it("returns null when not found", async () => {
      const result = await userRepository.findByTelegramId(999999);

      expect(result).toBeNull();
    });
  });

  describe("create", () => {
    it("inserts a new user and returns it", async () => {
      const user = makeUser();
      mockRows.push(user);

      const result = await userRepository.create({
        telegramId: 123456,
        username: "testuser",
      });

      expect(result).toEqual(user);
      expect(insertFn).toHaveBeenCalledOnce();
      expect(lastInsertValues).toMatchObject({
        telegramId: 123456,
        username: "testuser",
      });
      expect(returningFn).toHaveBeenCalled();
    });
  });

  describe("updateSettings", () => {
    it("upserts language settings with activeMode", async () => {
      const settings = makeSettings();
      mockRows.push(settings);

      const result = await userRepository.updateSettings(1, {
        interfaceLang: "en",
        nativeLang: "ru",
        learningLangs: ["cs"],
        timezone: "UTC",
        activeMode: "translate",
      });

      expect(result).toEqual(settings);
      expect(insertFn).toHaveBeenCalledOnce();
      expect(lastInsertValues).toMatchObject({
        userId: 1,
        interfaceLang: "en",
        nativeLang: "ru",
        activeMode: "translate",
      });
      expect(onConflictDoUpdateFn).toHaveBeenCalledOnce();
    });

    it("includes activeMode in the conflict update set", async () => {
      const settings = makeSettings({ activeMode: "mentor" });
      mockRows.push(settings);

      await userRepository.updateSettings(1, {
        interfaceLang: "en",
        nativeLang: "ru",
        learningLangs: ["cs"],
        timezone: "UTC",
        activeMode: "mentor",
      });

      // Verify onConflictDoUpdate was called with activeMode in the set
      const conflictCall = onConflictDoUpdateFn.mock.calls[0]![0] as Record<string, unknown>;
      const setObj = conflictCall.set as Record<string, unknown>;
      expect(setObj).toHaveProperty("activeMode", "mentor");
      expect(setObj).toHaveProperty("interfaceLang", "en");
      expect(setObj).toHaveProperty("updatedAt");
    });

    it("defaults activeMode to undefined when not provided", async () => {
      const settings = makeSettings();
      mockRows.push(settings);

      await userRepository.updateSettings(1, {
        interfaceLang: "en",
        nativeLang: "ru",
        learningLangs: ["cs"],
      });

      // activeMode should be present but undefined (schema default applies)
      expect(lastInsertValues).toMatchObject({
        userId: 1,
        interfaceLang: "en",
      });
    });

    it("allows exactly MAX_LEARNING_LANGS (4) languages", async () => {
      const settings = makeSettings({
        learningLangs: ["cs", "de", "fr", "es"],
      });
      mockRows.push(settings);

      const result = await userRepository.updateSettings(1, {
        interfaceLang: "en",
        nativeLang: "ru",
        learningLangs: ["cs", "de", "fr", "es"],
      });

      expect(result).toEqual(settings);
      expect(insertFn).toHaveBeenCalledOnce();
    });

    it("throws when learningLangs exceeds MAX_LEARNING_LANGS (BUG-09)", async () => {
      await expect(
        userRepository.updateSettings(1, {
          interfaceLang: "en",
          nativeLang: "ru",
          learningLangs: ["cs", "de", "fr", "es", "it"],
        }),
      ).rejects.toThrow(`Maximum ${MAX_LEARNING_LANGS} learning languages allowed, got 5`);

      // Should NOT have called the DB
      expect(insertFn).not.toHaveBeenCalled();
    });

    it("allows settings update when learningLangs is not provided", async () => {
      const settings = makeSettings();
      mockRows.push(settings);

      // No learningLangs in settings — should not throw
      const result = await userRepository.updateSettings(1, {
        interfaceLang: "en",
        nativeLang: "ru",
      } as Omit<typeof settings, "id" | "userId" | "isActive" | "updatedAt">);

      expect(result).toEqual(settings);
    });

    it("allows empty learningLangs array", async () => {
      const settings = makeSettings({ learningLangs: [] });
      mockRows.push(settings);

      const result = await userRepository.updateSettings(1, {
        interfaceLang: "en",
        nativeLang: "ru",
        learningLangs: [],
      });

      expect(result).toEqual(settings);
    });
  });

  describe("getSettings", () => {
    it("returns settings when found", async () => {
      const settings = makeSettings();
      mockRows.push(settings);

      const result = await userRepository.getSettings(1);

      expect(result).toEqual(settings);
      expect(limitFn).toHaveBeenCalledWith(1);
    });

    it("returns null when no settings exist", async () => {
      const result = await userRepository.getSettings(999);

      expect(result).toBeNull();
    });
  });

  describe("updateActiveMode", () => {
    it("updates activeMode and returns settings", async () => {
      const settings = makeSettings({ activeMode: "mentor" });
      updateReturningFn.mockResolvedValueOnce([settings]);

      const result = await userRepository.updateActiveMode(1, "mentor");

      expect(result).toEqual(settings);
      expect(updateFn).toHaveBeenCalledOnce();
      expect(lastUpdateSet).toMatchObject({ activeMode: "mentor" });
      expect(lastUpdateSet).toHaveProperty("updatedAt");
    });

    it("sets updatedAt timestamp", async () => {
      const before = new Date();
      const settings = makeSettings();
      updateReturningFn.mockResolvedValueOnce([settings]);

      await userRepository.updateActiveMode(1, "translate");

      const after = new Date();
      const updatedAt = (lastUpdateSet as Record<string, unknown>).updatedAt as Date;
      expect(updatedAt).toBeInstanceOf(Date);
      expect(updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("returns null when user has no settings row", async () => {
      updateReturningFn.mockResolvedValueOnce([]);

      const result = await userRepository.updateActiveMode(999, "translate");

      expect(result).toBeNull();
    });

    it("only sets activeMode and updatedAt — no other fields", async () => {
      const settings = makeSettings();
      updateReturningFn.mockResolvedValueOnce([settings]);

      await userRepository.updateActiveMode(1, "quiz");

      const setKeys = Object.keys(lastUpdateSet as object);
      expect(setKeys).toContain("activeMode");
      expect(setKeys).toContain("updatedAt");
      expect(setKeys).toHaveLength(2);
    });
  });

  describe("updateOnboardingStep", () => {
    it("updates the onboarding step", async () => {
      const user = makeUser({ onboardingStep: 2 });
      updateReturningFn.mockResolvedValueOnce([user]);

      const result = await userRepository.updateOnboardingStep(1, 2);

      expect(result).toEqual(user);
      expect(lastUpdateSet).toMatchObject({ onboardingStep: 2 });
    });
  });

  describe("markOnboarded", () => {
    it("sets onboarded to true and step to 3 (BRD §5 — 3-step onboarding)", async () => {
      const user = makeUser({ onboarded: true, onboardingStep: 3 });
      updateReturningFn.mockResolvedValueOnce([user]);

      const result = await userRepository.markOnboarded(1);

      expect(result).toEqual(user);
      expect(lastUpdateSet).toMatchObject({
        onboarded: true,
        onboardingStep: 3,
      });
    });
  });
});
