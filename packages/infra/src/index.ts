// @polyglot/infra — infrastructure scripts and utilities
// See src/scripts/ for CLI tools.

export type { BaseEnv, BotEnv, Env } from "./config.js";
export { baseEnvSchema, botEnvSchema, ConfigError, loadConfig, telegramEnvSchema } from "./config.js";
