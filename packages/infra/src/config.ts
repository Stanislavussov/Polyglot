import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { z } from "zod";

/**
 * Base environment shared by every app in the monorepo. It deliberately does
 * NOT include any channel-specific secrets (e.g. Telegram's `BOT_TOKEN`), so an
 * app that never talks to Telegram — admin API, workers — can load its config
 * without one (Fable T24/A18).
 */
export const baseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  OPENROUTER_API_KEY: z.string().optional(),
  BETTERSTACK_TOKEN: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

/**
 * Channel extension carrying the Telegram bot secret. Compose it onto the base
 * schema only in apps that actually run the Telegram channel.
 */
export const telegramEnvSchema = z.object({
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN is required"),
});

/** Full env schema for the Telegram bot: base + telegram channel extension. */
export const botEnvSchema = baseEnvSchema.extend(telegramEnvSchema.shape);

export type BaseEnv = z.infer<typeof baseEnvSchema>;
export type BotEnv = z.infer<typeof botEnvSchema>;
/** Backwards-compatible alias for the Telegram bot's env shape. */
export type Env = BotEnv;

/**
 * Thrown by {@link loadConfig} when environment variables fail validation.
 * Library code never calls `process.exit` — the application entry point decides
 * how to surface the failure (Fable T24/A18).
 */
export class ConfigError extends Error {
  constructor(
    message: string,
    /** Zod's treeified issue report, safe to log for diagnostics. */
    readonly issues: unknown,
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Walk up from cwd looking for a `.env` file so that any app
 * in the monorepo can call `loadConfig()` without worrying
 * about its own working directory.
 */
function findEnvFile(): string | undefined {
  let dir = process.cwd();
  while (true) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Load and validate environment variables against the given schema. Each app
 * passes the schema it needs — {@link baseEnvSchema} for channel-less apps,
 * {@link botEnvSchema} for the Telegram bot. Defaults to the base schema.
 *
 * Throws {@link ConfigError} on invalid env; never exits the process.
 */
export function loadConfig<T extends z.ZodTypeAny = typeof baseEnvSchema>(schema?: T): z.infer<T> {
  const envPath = findEnvFile();
  if (envPath) {
    dotenvConfig({ path: envPath });
  }

  const effectiveSchema = (schema ?? baseEnvSchema) as z.ZodTypeAny;
  const result = effectiveSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = z.treeifyError(result.error);
    throw new ConfigError("Invalid environment variables", formatted);
  }

  return result.data as z.infer<T>;
}
