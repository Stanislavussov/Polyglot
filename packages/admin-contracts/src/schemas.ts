import { z } from "zod";

/**
 * Shared admin ↔ admin-api contracts (Fable T27, finding D4).
 *
 * These zod schemas are the SINGLE source of truth for the admin panel forms
 * (`apps/admin`) and the admin-api route handlers (`apps/admin-api`). Numeric
 * fields use `z.coerce.number()` so the same schema validates both HTML form
 * strings (frontend) and JSON numbers (backend) without drift.
 */

// ── Auth ────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

// ── Users ───────────────────────────────────────────────────────────────────

export const subscriptionPlanSchema = z.string().min(1, "Choose a plan").max(50, "Plan name is too long");
export const audienceGroupSchema = z.enum(["admin", "tester", "product"]);

// ── Rate-limit plans ──────────────────────────────────────────────────────────

export const rateLimitPlanSchema = z.object({
  name: z.string().min(1, "Name is required").max(50, "Name is too long"),
  label: z.string().min(1, "Label is required").max(100, "Label is too long"),
  translationLimit: z.coerce.number().int("Limit must be an integer").min(0, "Limit cannot be negative").nullable(),
  videoLimit: z.coerce
    .number()
    .int("Video limit must be an integer")
    .min(0, "Video limit cannot be negative")
    .nullable()
    .default(null),
  videoWindow: z.enum(["none", "lifetime", "monthly"]).default("none"),
  creditCost: z.coerce
    .number()
    .int("Credit cost must be an integer")
    .min(1, "Credit cost must be at least 1")
    .default(1),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  /** Model this plan's users are served by. null = use the globally default model. */
  aiModelId: z.string().min(1).max(255).nullable().default(null),
});

// ── Translation presets ───────────────────────────────────────────────────────

export const presetConfigSchema = z.object({
  synonyms: z.boolean(),
  examples: z.boolean(),
  alternatives: z.boolean(),
  equivalentNote: z.boolean(),
  connotationWarning: z.boolean(),
});

export const presetCreateSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
  label: z.string().min(1, "Label is required").max(255, "Label is too long"),
  config: presetConfigSchema,
  isActive: z.boolean().default(true),
});

export const presetUpdateSchema = z.object({
  label: z.string().min(1, "Label is required").max(255, "Label is too long").optional(),
  config: presetConfigSchema.optional(),
  isActive: z.boolean().optional(),
});

// ── Word-picker presets ───────────────────────────────────────────────────────

/**
 * A curated angle on a language, offered to the user as the first step in the
 * bot's main menu. `prompt` is the instruction handed to the model, so it is the
 * field that decides what the angle actually produces — hence the length floor.
 */
export const wordPickerPresetCreateSchema = z.object({
  slug: z
    .string()
    .min(1, "Slug is required")
    .max(64, "Slug is too long")
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, digits and hyphens"),
  emoji: z.string().min(1, "Emoji is required").max(16, "Emoji is too long"),
  title: z.string().min(1, "Title is required").max(120, "Title is too long"),
  /** Interface-language code → title; missing codes fall back to `title`. */
  titleI18n: z.record(z.string(), z.string().max(120, "Translated title is too long")).default({}),
  prompt: z.string().min(20, "Describe the angle in at least 20 characters").max(4000, "Prompt is too long"),
  /** Learning languages this angle is offered for; empty means every language. */
  learningLangs: z.array(z.string().min(2).max(16)).default([]),
  sortOrder: z.coerce.number().int("Order must be an integer").min(0, "Order cannot be negative").default(0),
  isActive: z.boolean().default(true),
});

export const wordPickerPresetUpdateSchema = wordPickerPresetCreateSchema.omit({ slug: true }).partial();

// ── AI models ─────────────────────────────────────────────────────────────────

export const aiModelCreateSchema = z.object({
  id: z.string().min(1, "Model ID is required").max(255, "Model ID is too long"),
  name: z.string().min(1, "Display name is required").max(255, "Display name is too long"),
  provider: z.string().min(1, "Provider is required").max(100, "Provider is too long"),
  maxTokens: z.coerce.number().int("Max tokens must be an integer").min(1, "Max tokens must be at least 1"),
  costPer1kInput: z.coerce.number().min(0, "Input cost cannot be negative"),
  costPer1kOutput: z.coerce.number().min(0, "Output cost cannot be negative"),
  isEnabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  isFallback: z.boolean().default(false),
});

export const aiModelUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  provider: z.string().min(1).max(100).optional(),
  maxTokens: z.coerce.number().int().min(1).optional(),
  costPer1kInput: z.coerce.number().min(0).optional(),
  costPer1kOutput: z.coerce.number().min(0).optional(),
  isEnabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  isFallback: z.boolean().optional(),
});

export const aiModelSelectSchema = z.object({
  id: z.string().min(1, "Choose a model"),
});

/** Body of the "which model is the failover" write. `null` = no failover model. */
export const aiModelFallbackSchema = z.object({
  modelId: z.string().min(1).max(255).nullable(),
});

// ── Settings: AI generation defaults ──────────────────────────────────────────

export const aiDefaultsSchema = z.object({
  maxTokens: z.coerce.number().int("Max tokens must be an integer").min(1, "Max tokens must be at least 1"),
  temperature: z.coerce.number().min(0, "Temperature cannot be negative").max(2, "Temperature cannot exceed 2"),
  frequencyPenalty: z.coerce
    .number()
    .min(0, "Frequency penalty cannot be negative")
    .max(2, "Frequency penalty cannot exceed 2"),
  maxRetries: z.coerce.number().int("Max retries must be an integer").min(0).max(10),
  // Capped below the bot's 20 s loader guard so the adapter aborts first.
  requestTimeoutMs: z.coerce
    .number()
    .int("Request timeout must be an integer")
    .min(1_000, "Request timeout must be at least 1000 ms")
    .max(20_000, "Request timeout cannot exceed 20000 ms"),
});

// ── Settings: notifications ────────────────────────────────────────────────────

export const notificationSettingsSchema = z.object({
  defaultTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM format"),
  defaultType: z.enum(["suggested", "srs", "contextual"]),
  inactivityDays: z.coerce.number().int("Inactivity days must be an integer").min(1),
  notificationTimesLimit: z.coerce
    .number()
    .int("Notification times limit must be an integer")
    .min(1)
    .max(48)
    .default(12),
});

// ── Settings: SRS ──────────────────────────────────────────────────────────────

export const srsSettingsSchema = z.object({
  minEaseFactor: z.coerce.number().min(1, "Minimum ease factor must be at least 1").max(3),
  defaultEaseFactor: z.coerce.number().min(1, "Default ease factor must be at least 1").max(5),
});

// ── Settings: dictionary ───────────────────────────────────────────────────────

export const dictionarySettingsSchema = z.object({
  flashcardLimit: z.coerce.number().int("Flashcard limit must be an integer").min(1),
  notificationDictLimit: z.coerce.number().int("Notification dictionary limit must be an integer").min(1),
  wordOfDayLimit: z.coerce.number().int("Word of day limit must be an integer").min(1),
});

// ── Settings: video vocabulary ─────────────────────────────────────────────────

/**
 * TTS settings. `voice` may be empty because some speech models expose no voice
 * concept at all, but `modelId` may not: an enabled config with a blank model
 * renders no pronunciation button, which reads as a broken feature rather than a
 * disabled one. Turning it off is what `enabled: false` is for.
 */
export const ttsSettingsSchema = z.object({
  enabled: z.coerce.boolean(),
  modelId: z.string().min(1, "TTS model is required"),
  voice: z.string(),
  maxChars: z.coerce.number().int("Max characters must be an integer").min(1).max(5000),
});

export const videoVocabularySettingsSchema = z
  .object({
    monthlyLimit: z.coerce.number().int("Monthly limit must be an integer").min(1),
    minPhrases: z.coerce.number().int("Minimum phrases must be an integer").min(1),
    maxPhrases: z.coerce.number().int("Maximum phrases must be an integer").min(1),
    extractionModelId: z.string().min(1, "Extraction model is required"),
  })
  .refine((c) => c.maxPhrases >= c.minPhrases, {
    message: "maxPhrases must be greater than or equal to minPhrases",
    path: ["maxPhrases"],
  });

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Flatten a ZodError into a single user-facing string for form error display. */
export function zodErrorMessage(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}
