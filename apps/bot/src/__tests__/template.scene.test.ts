/**
 * Tests for template wizard scene and helper handlers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies before imports
vi.mock("@polyglot/adapter-db", () => ({
  translationTemplateRepository: {
    getByUserId: vi.fn(),
    upsert: vi.fn(),
    deleteByUserId: vi.fn(),
  },
  userRepository: {
    getSettings: vi.fn().mockResolvedValue({ interfaceLang: "en" }),
  },
}));

vi.mock("@polyglot/core", async () => {
  const actual = await vi.importActual<typeof import("@polyglot/core")>("@polyglot/core");
  return {
    ...actual,
    getLangFlag: vi.fn((code: string) => {
      const flags: Record<string, string> = { en: "🇬🇧", ru: "🇷🇺" };
      return flags[code];
    }),
  };
});

vi.mock("@polyglot/infra", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  loadConfig: () => ({ AI_MODEL: "test-model", BOT_TOKEN: "test" }),
}));

import { translationTemplateRepository } from "@polyglot/adapter-db";
import { DEFAULT_TEMPLATE } from "@polyglot/core";
import {
  handleBackCallback,
  handleCancelCallback,
  handleCustomizeCallback,
  handlePreviewCallback,
  handleResetCallback,
  handleSaveTemplateCallback,
  handleToggleCallback,
} from "../scenes/helpers/template.helper.js";
import { handleTemplateCommand } from "../scenes/template.scene.js";

/** Create a minimal mock BotContext */
function createMockCtx(callbackData?: string) {
  const session: any = {
    activeMode: "translate",
    templateWizard: undefined,
  };

  return {
    user: { id: 1 },
    session,
    from: { id: 12345 },
    callbackQuery: callbackData ? { data: callbackData, message: { message_id: 100 } } : undefined,
    reply: vi.fn().mockResolvedValue({ message_id: 200 }),
    editMessageText: vi.fn().mockResolvedValue({}),
    answerCallbackQuery: vi.fn().mockResolvedValue({}),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("handleTemplateCommand", () => {
  it("shows default template info when user has no custom template", async () => {
    vi.mocked(translationTemplateRepository.getByUserId).mockResolvedValue(null);
    const ctx = createMockCtx();

    await handleTemplateCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const text = ctx.reply.mock.calls[0][0] as string;
    expect(text).toContain("⚙️ Translation Template");
    expect(text).toContain("Default");
    expect(text).toContain("default template");
  });

  it("shows custom template info when user has one", async () => {
    vi.mocked(translationTemplateRepository.getByUserId).mockResolvedValue({
      id: 1,
      userId: 1,
      name: "Custom",
      fields: { ...DEFAULT_TEMPLATE.fields, synonyms: false },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const ctx = createMockCtx();

    await handleTemplateCommand(ctx);

    const text = ctx.reply.mock.calls[0][0] as string;
    expect(text).toContain("Custom");
    expect(text).toContain("custom template");
  });

  it("sends reply with Customize and Reset buttons", async () => {
    vi.mocked(translationTemplateRepository.getByUserId).mockResolvedValue(null);
    const ctx = createMockCtx();

    await handleTemplateCommand(ctx);

    const opts = ctx.reply.mock.calls[0][1];
    const buttons = opts.reply_markup.inline_keyboard.flat();
    const cbData = buttons.map((b: any) => b.callback_data);
    expect(cbData).toContain("tpl:customize");
    expect(cbData).toContain("tpl:reset");
  });
});

describe("handleCustomizeCallback", () => {
  it("initializes templateWizard in session with default fields", async () => {
    vi.mocked(translationTemplateRepository.getByUserId).mockResolvedValue(null);
    const ctx = createMockCtx("tpl:customize");

    await handleCustomizeCallback(ctx);

    expect(ctx.session.templateWizard).toBeDefined();
    expect(ctx.session.templateWizard!.fields).toEqual(DEFAULT_TEMPLATE.fields);
  });

  it("shows toggle keyboard with all 6 fields", async () => {
    vi.mocked(translationTemplateRepository.getByUserId).mockResolvedValue(null);
    const ctx = createMockCtx("tpl:customize");

    await handleCustomizeCallback(ctx);

    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    const opts = ctx.editMessageText.mock.calls[0][1];
    const buttons = opts.reply_markup.inline_keyboard.flat();
    // 5 field toggle buttons + 3 action buttons
    expect(buttons.length).toBe(8);
  });
});

describe("handleToggleCallback", () => {
  it("toggles a field from true to false", async () => {
    const ctx = createMockCtx("tpl:toggle:synonyms");
    ctx.session.templateWizard = {
      fields: { ...DEFAULT_TEMPLATE.fields },
    };

    await handleToggleCallback(ctx);
  });

  it("toggles a field from false to true", async () => {
    const ctx = createMockCtx("tpl:toggle:synonyms");
    ctx.session.templateWizard = {
      fields: { ...DEFAULT_TEMPLATE.fields, synonyms: false },
    };

    await handleToggleCallback(ctx);

    expect(ctx.session.templateWizard!.fields.synonyms).toBe(true);
  });

  it("shows session expired when templateWizard is missing", async () => {
    const ctx = createMockCtx("tpl:toggle:synonyms");

    await handleToggleCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.objectContaining({ show_alert: true }));
  });

  it("ignores unknown field keys", async () => {
    const ctx = createMockCtx("tpl:toggle:unknown");
    ctx.session.templateWizard = {
      fields: { ...DEFAULT_TEMPLATE.fields },
    };

    await handleToggleCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalled();
    // Fields unchanged
    expect(ctx.session.templateWizard!.fields).toEqual(DEFAULT_TEMPLATE.fields);
  });
});

describe("handleSaveTemplateCallback", () => {
  it("persists template to DB and clears wizard state", async () => {
    vi.mocked(translationTemplateRepository.upsert).mockResolvedValue({
      id: 1,
      userId: 1,
      name: "Custom",
      fields: { ...DEFAULT_TEMPLATE.fields, synonyms: false },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const ctx = createMockCtx("tpl:save");
    ctx.session.templateWizard = {
      fields: { ...DEFAULT_TEMPLATE.fields, synonyms: false },
    };

    await handleSaveTemplateCallback(ctx);

    expect(translationTemplateRepository.upsert).toHaveBeenCalledWith(
      1,
      "Custom",
      expect.objectContaining({ synonyms: false }),
    );
    expect(ctx.session.templateWizard).toBeUndefined();
    const text = ctx.editMessageText.mock.calls[0][0] as string;
    expect(text).toContain("Template saved");
  });
});

describe("handleCancelCallback", () => {
  it("clears wizard state and shows cancelled message", async () => {
    const ctx = createMockCtx("tpl:cancel");
    ctx.session.templateWizard = {
      fields: { ...DEFAULT_TEMPLATE.fields },
    };

    await handleCancelCallback(ctx);

    expect(ctx.session.templateWizard).toBeUndefined();
    const text = ctx.editMessageText.mock.calls[0][0] as string;
    expect(text).toContain("cancelled");
  });
});

describe("handleResetCallback", () => {
  it("deletes template from DB and shows reset confirmation", async () => {
    vi.mocked(translationTemplateRepository.deleteByUserId).mockResolvedValue();
    const ctx = createMockCtx("tpl:reset");

    await handleResetCallback(ctx);

    expect(translationTemplateRepository.deleteByUserId).toHaveBeenCalledWith(1);
    const text = ctx.editMessageText.mock.calls[0][0] as string;
    expect(text).toContain("reset to default");
  });
});

describe("handlePreviewCallback", () => {
  it("shows session expired when templateWizard is missing", async () => {
    const ctx = createMockCtx("tpl:preview");

    await handlePreviewCallback(ctx);

    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith(expect.objectContaining({ show_alert: true }));
  });

  it("renders preview with current template fields", async () => {
    const ctx = createMockCtx("tpl:preview");
    ctx.session.templateWizard = {
      fields: { ...DEFAULT_TEMPLATE.fields },
    };

    await handlePreviewCallback(ctx);

    const text = ctx.editMessageText.mock.calls[0][0] as string;
    expect(text).toContain("Preview");
    expect(text).toContain("🍎");
  });
});

describe("handleBackCallback", () => {
  it("returns to constructor keyboard from preview", async () => {
    const ctx = createMockCtx("tpl:back");
    ctx.session.templateWizard = {
      fields: { ...DEFAULT_TEMPLATE.fields },
    };

    await handleBackCallback(ctx);

    const text = ctx.editMessageText.mock.calls[0][0] as string;
    expect(text).toContain("Template Constructor");
  });
});
