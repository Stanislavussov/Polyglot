import type { MiddlewareHandler } from "astro";
import { isValidAdminToken, PANEL_SESSION_COOKIE } from "./lib/admin-session";

/**
 * Gates the sensitive reports (database schema, architecture map, test catalog).
 * They used to be anonymous static assets under `public/reports` (S3); they are
 * now served by the SSR endpoint at `/reports/[...file]` and only to a request
 * carrying a valid session cookie, which only the panel server can set. Everything else passes through.
 */
export const onRequest: MiddlewareHandler = async (context, next) => {
  if (context.url.pathname.startsWith("/reports/")) {
    const token = context.cookies.get(PANEL_SESSION_COOKIE)?.value;
    if (!(await isValidAdminToken(token, context.request.headers.get("x-forwarded-for")))) {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  return next();
};
