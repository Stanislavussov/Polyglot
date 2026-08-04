import { resolve } from "node:path";
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load .env from monorepo root (drizzle-kit runs with cwd = package dir)
config({ path: resolve(__dirname, "../../../.env") });

/**
 * Strip `channel_binding` from the connection string.
 *
 * Neon hands out URLs carrying `channel_binding=require`. That is a **libpq**
 * option: it tells the client to insist on `SCRAM-SHA-256-PLUS`. No JS driver
 * implements channel binding, so the app's `postgres.js` connection simply
 * ignores the parameter — but drizzle-kit's client honours it far enough to
 * negotiate an auth mechanism it cannot complete, and the server rejects the
 * handshake as `28P01 password authentication failed`. The credentials are
 * fine; the failure is indistinguishable from a wrong password, which is what
 * makes it worth a comment.
 *
 * Dropping it costs no real security — nothing in this stack could satisfy the
 * requirement anyway — and `sslmode=require` still applies. Only drizzle-kit's
 * connection is affected; the runtime URL is untouched.
 */
function withoutChannelBinding(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete("channel_binding");
  return parsed.toString();
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set — drizzle-kit cannot connect. Check the monorepo-root .env.");
}

export default defineConfig({
  out: "./drizzle",
  schema: "./src/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: withoutChannelBinding(databaseUrl),
  },
});
