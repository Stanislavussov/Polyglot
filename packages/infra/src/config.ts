import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { config as dotenvConfig } from "dotenv";
import { z } from "zod";

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN is required"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  OPENROUTER_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("openai/gpt-5-nano"),
  BETTERSTACK_TOKEN: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof envSchema>;

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

export function loadConfig(): Env {
  const envPath = findEnvFile();
  if (envPath) {
    dotenvConfig({ path: envPath });
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = z.treeifyError(result.error);
    console.error("❌ Invalid environment variables:", formatted);
    process.exit(1);
  }

  return result.data;
}
