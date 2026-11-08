export interface WebApiConfig {
  port: number;
  host: string;
  production: boolean;
  botToken: string;
  jwtSecret: string;
  /** The only Origin a state-changing request may come from, e.g. https://learn.polyglot.monster. */
  appOrigin: string;
  /** Built `apps/web` output served at `/`; absent in dev, where Astro serves the pages. */
  staticDir: string | null;
  /** Dev-only one-click login as this user; always null in production. */
  devUserId: number | null;
  /** The bot the plan page's upgrade link opens; buying happens there. */
  botUsername: string;
}

const PRODUCTION_BOT_USERNAME = "polyglot_lang_ai_bot";

const MIN_SECRET_LENGTH = 32;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`web-api: ${name} is required`);
  return value;
}

/** Fails at boot, not on the first login: a missing secret must never yield a running, unsigned service. */
export function loadConfig(env: NodeJS.ProcessEnv): WebApiConfig {
  const jwtSecret = required(env, "WEB_JWT_SECRET");
  if (jwtSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(`web-api: WEB_JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  const production = env.NODE_ENV === "production";
  return {
    port: Number.parseInt(env.WEB_API_PORT ?? "3002", 10),
    host: env.HOST ?? "0.0.0.0",
    production,
    botToken: required(env, "BOT_TOKEN"),
    jwtSecret,
    appOrigin: production ? required(env, "WEB_APP_ORIGIN") : (env.WEB_APP_ORIGIN ?? "http://localhost:4322"),
    staticDir: env.WEB_STATIC_DIR?.trim() || null,
    // Never honoured in production, whatever the env says: it signs in without Telegram.
    devUserId: !production && env.WEB_DEV_USER_ID ? Number.parseInt(env.WEB_DEV_USER_ID, 10) : null,
    botUsername: env.WEB_BOT_USERNAME?.trim() || PRODUCTION_BOT_USERNAME,
  };
}
