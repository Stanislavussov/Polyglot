import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export const subscriptionPlanSchema = z.string().min(1, "Choose a plan").max(50, "Plan name is too long");
export const audienceGroupSchema = z.enum(["admin", "tester", "product"]);

export const rateLimitPlanSchema = z.object({
  name: z.string().min(1, "Name is required").max(50, "Name is too long"),
  label: z.string().min(1, "Label is required").max(100, "Label is too long"),
  creditsPerDay: z.coerce.number().int("Credits must be an integer").min(0, "Credits cannot be negative").nullable(),
  windowMs: z.coerce.number().int("Window must be an integer").min(1, "Window must be at least 1 ms"),
  creditCost: z.coerce.number().int("Credit cost must be an integer").min(1, "Credit cost must be at least 1"),
  isActive: z.boolean(),
  isDefault: z.boolean(),
});

export const presetConfigSchema = z.object({
  transcription: z.boolean(),
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
  isActive: z.boolean(),
});

export const presetUpdateSchema = presetCreateSchema.pick({
  label: true,
  config: true,
  isActive: true,
});

export const aiModelCreateSchema = z.object({
  id: z.string().min(1, "Model ID is required").max(255, "Model ID is too long"),
  name: z.string().min(1, "Display name is required").max(255, "Display name is too long"),
  provider: z.string().min(1, "Provider is required").max(100, "Provider is too long"),
  maxTokens: z.coerce.number().int("Max tokens must be an integer").min(1, "Max tokens must be at least 1"),
  costPer1kInput: z.coerce.number().min(0, "Input cost cannot be negative"),
  costPer1kOutput: z.coerce.number().min(0, "Output cost cannot be negative"),
  isEnabled: z.boolean(),
  allowedPlans: z.array(z.string().min(1)).min(1, "Choose at least one subscription plan"),
});

export const aiModelUpdateSchema = aiModelCreateSchema.omit({ id: true });

export const aiModelSelectSchema = z.object({
  id: z.string().min(1, "Choose a model"),
});

export const aiDefaultsSchema = z.object({
  maxTokens: z.coerce.number().int("Max tokens must be an integer").min(1, "Max tokens must be at least 1"),
  temperature: z.coerce.number().min(0, "Temperature cannot be negative").max(2, "Temperature cannot exceed 2"),
  frequencyPenalty: z.coerce
    .number()
    .min(0, "Frequency penalty cannot be negative")
    .max(2, "Frequency penalty cannot exceed 2"),
  maxRetries: z.coerce.number().int("Max retries must be an integer").min(0).max(10),
});

export const notificationSettingsSchema = z.object({
  defaultTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM format"),
  defaultType: z.enum(["suggested", "srs", "contextual"]),
  inactivityDays: z.coerce.number().int("Inactivity days must be an integer").min(1),
});

export const srsSettingsSchema = z.object({
  minEaseFactor: z.coerce.number().min(1, "Minimum ease factor must be at least 1").max(3),
  defaultEaseFactor: z.coerce.number().min(1, "Default ease factor must be at least 1").max(5),
});

export const translationSettingsSchema = z.object({
  maxTranscriptionLength: z.coerce.number().int("Maximum transcription length must be an integer").min(1),
});

export const dictionarySettingsSchema = z.object({
  flashcardLimit: z.coerce.number().int("Flashcard limit must be an integer").min(1),
  notificationDictLimit: z.coerce.number().int("Notification dictionary limit must be an integer").min(1),
  wordOfDayLimit: z.coerce.number().int("Word of day limit must be an integer").min(1),
});

export function zodErrorMessage(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}
