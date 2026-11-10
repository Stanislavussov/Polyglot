import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../../../.env") });

const { buildWebApiApp } = await import("./app.js");
const { loadConfig } = await import("./config.js");
const { createWebServices } = await import("./container.js");

const config = loadConfig(process.env);
const services = createWebServices();
await services.languageCache.loadLanguageCache();
const app = await buildWebApiApp(services, config, { logger: true });
await app.listen({ port: config.port, host: config.host });
