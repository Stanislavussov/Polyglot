import fastifyJwt from "@fastify/jwt";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { originGuard } from "./auth/origin-guard.js";
import { installSessionGuard } from "./auth/session.js";
import { SESSION_TTL_SECONDS } from "./auth/session-cookie.js";
import type { WebApiConfig } from "./config.js";
import { articleRoutes } from "./routes/articles.js";
import { authRoutes } from "./routes/auth.js";
import { cardAudioRoutes } from "./routes/card-audio.js";
import { cardExploreRoutes } from "./routes/card-explore.js";
import { changesRoutes } from "./routes/changes.js";
import { dictionaryRoutes } from "./routes/dictionary.js";
import { entryExploreRoutes } from "./routes/entry-explore.js";
import { learnPracticeRoutes } from "./routes/learn-practice.js";
import { loaderRoutes } from "./routes/loader.js";
import { meRoutes } from "./routes/me.js";
import { mentorChatRoutes } from "./routes/mentor-chat.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { planRoutes } from "./routes/plan.js";
import { progressRoutes } from "./routes/progress.js";
import { pushRoutes } from "./routes/push.js";
import { reportRoutes } from "./routes/report.js";
import { reviewRoutes } from "./routes/review.js";
import { settingsRoutes } from "./routes/settings.js";
import { templateRoutes } from "./routes/template.js";
import { translateRoutes } from "./routes/translate.js";
import { videoRoutes } from "./routes/videos.js";
import { voiceRoutes } from "./routes/voice.js";
import { wordPickerRoutes } from "./routes/word-picker.js";
import type { WebServices } from "./services.js";
import { inlineScriptHashes } from "./static-csp.js";

// Telegram's widget script and its login iframe are the only third parties.
function contentSecurityPolicy(scriptHashes: string[]): string {
  return [
    "default-src 'self'",
    ["script-src 'self' https://telegram.org", ...scriptHashes].join(" "),
    "frame-src https://oauth.telegram.org",
    "img-src 'self' data: https://t.me https://*.telegram.org",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self'",
    // Pronunciation arrives as fetched bytes played from a blob: URL.
    "media-src 'self' blob:",
    "frame-ancestors 'none'",
  ].join("; ");
}

export interface BuildOptions {
  logger?: boolean;
  /** Seconds clock for the login freshness check; tests pin it. */
  now?: () => number;
}

export async function buildWebApiApp(
  services: WebServices,
  config: WebApiConfig,
  options: BuildOptions = {},
): Promise<FastifyInstance> {
  // Reachable only through the nginx reverse proxy: trust exactly that one hop,
  // so the rate limit keys on the real client IP.
  const app = Fastify({ logger: options.logger ?? false, trustProxy: (_address, hop) => hop === 0 });

  await app.register(fastifyJwt, { secret: config.jwtSecret, sign: { expiresIn: SESSION_TTL_SECONDS } });
  // Static files are exempt: one page load fetches ~20 assets, which used up the
  // per-minute budget after a few clicks. The limit guards the API, not the files.
  await app.register(import("@fastify/rate-limit"), {
    global: true,
    max: 120,
    timeWindow: "1 minute",
    allowList: (request) => !request.url.startsWith("/api/"),
  });

  const csp = contentSecurityPolicy(config.staticDir ? inlineScriptHashes(config.staticDir) : []);
  app.addHook("onSend", async (request, reply) => {
    reply.header("content-security-policy", csp);
    // A cached service worker keeps an old push handler alive; the browser must revalidate it every time.
    if (request.url === "/sw.js") reply.header("cache-control", "no-cache");
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "same-origin");
  });
  app.addHook("preHandler", originGuard(config.appOrigin));
  installSessionGuard(app, services, config.production);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, "Unhandled web-api error");
      return reply.status(500).send({ code: "internal" });
    }
    return reply.status(status).send({ code: error.code ?? "bad_request" });
  });

  // DB-free on purpose: a liveness probe that pings Postgres keeps Neon awake 24/7.
  app.get("/livez", async () => ({ status: "ok" }));

  authRoutes(app, services, config, options.now);
  meRoutes(app, services);
  settingsRoutes(app, services, config.vapidPublicKey);
  pushRoutes(app, services, config.vapidPublicKey);
  dictionaryRoutes(app, services);
  translateRoutes(app, services, config.jwtSecret);
  reviewRoutes(app, services);
  cardAudioRoutes(app, services);
  cardExploreRoutes(app, services);
  entryExploreRoutes(app, services);
  loaderRoutes(app, services);
  templateRoutes(app, services);
  planRoutes(app, services, config.botUsername);
  changesRoutes(app, services);
  reportRoutes(app, services);
  mentorChatRoutes(app, services);
  learnPracticeRoutes(app, services);
  wordPickerRoutes(app, services);
  videoRoutes(app, services);
  articleRoutes(app, services);
  progressRoutes(app, services);
  onboardingRoutes(app, services);
  voiceRoutes(app, services);

  if (config.staticDir) {
    await app.register(import("@fastify/static"), { root: config.staticDir, wildcard: false });
    // Astro emits one directory per page; an unknown non-API path falls back to the app shell.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) return reply.status(404).send({ code: "not_found" });
      return reply.sendFile("index.html");
    });
  }

  return app;
}
