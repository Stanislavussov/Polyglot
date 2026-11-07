export interface WebApiConfig {
  port: number;
  host: string;
  production: boolean;
  botToken: string;
  jwtSecret: string;
  /** Origins a state-changing request may come from, e.g. https://learn.polyglot.monster. */
  appOrigins: string[];
  /** Built `apps/web` output served at `/`; absent in dev, where Astro serves the pages. */
  staticDir: string | null;
  /** Dev-only one-click login as this user; always null in production. */
  devUserId: number | null;
}

const MIN_SECRET_LENGTH = 32;

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`web-api: ${name} is required`);
  return value;
}

/** Fails at boot, not on the first login: a missing secret must never yield a running, unsigned service. */
// A browser sends Origin without a trailing slash, so "https://x/" in the env would never match.
function parseOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter((origin) => origin !== "");
}

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
    appOrigins: parseOrigins(
      production ? required(env, "WEB_APP_ORIGIN") : (env.WEB_APP_ORIGIN ?? "http://localhost:4322"),
    ),
    staticDir: env.WEB_STATIC_DIR?.trim() || null,
    // Never honoured in production, whatever the env says: it signs in without Telegram.
    devUserId: !production && env.WEB_DEV_USER_ID ? Number.parseInt(env.WEB_DEV_USER_ID, 10) : null,
  };
}
