import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";
import Fastify from "fastify";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../../../.env") });

import { authPlugin } from "./plugins/auth.js";
import { aiDefaultRoutes } from "./routes/ai-defaults.js";
import { aiModelRoutes } from "./routes/ai-models.js";
import { authRoutes } from "./routes/auth.js";
import { dictionaryRoutes } from "./routes/dictionary.js";
import { notificationRoutes } from "./routes/notifications.js";
import { presetRoutes } from "./routes/presets.js";
import { rateLimitRoutes } from "./routes/rate-limits.js";
import { reportedIssueRoutes } from "./routes/reported-issues.js";
import { srsRoutes } from "./routes/srs.js";
import { statsRoutes } from "./routes/stats.js";
import { userRoutes } from "./routes/users.js";

const PORT = Number.parseInt(process.env.PORT ?? "3001", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

function adminPanelOrigins(): string[] {
  return (process.env.ADMIN_PANEL_URL ?? "http://localhost:4321")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export async function buildAdminApiApp() {
  const app = Fastify({ logger: true });

  await app.register(import("@fastify/cors"), {
    origin: [...new Set([...adminPanelOrigins(), "http://localhost:4321"])],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });

  await app.register(authPlugin);

  app.get("/healthz", async () => ({ status: "ok" }));

  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(rateLimitRoutes, { prefix: "/api/settings" });
  await app.register(aiModelRoutes, { prefix: "/api/settings" });
  await app.register(aiDefaultRoutes, { prefix: "/api/settings" });
  await app.register(notificationRoutes, { prefix: "/api/settings" });
  await app.register(srsRoutes, { prefix: "/api/settings" });
  await app.register(dictionaryRoutes, { prefix: "/api/settings" });
  await app.register(presetRoutes, { prefix: "/api/settings" });
  await app.register(userRoutes, { prefix: "/api" });
  await app.register(reportedIssueRoutes, { prefix: "/api" });
  await app.register(statsRoutes, { prefix: "/api" });

  return app;
}

export async function startAdminApi(): Promise<void> {
  const app = await buildAdminApiApp();
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info(`Admin API listening on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await startAdminApi();
}
