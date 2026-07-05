import type { MiddlewareHandler } from "astro";

/**
 * Server-to-server admin-API base URL used to verify report-access tokens.
 * In prod the admin container reaches admin-api over the compose network
 * (`http://admin-api:3001`); in dev it falls back to localhost.
 */
const ADMIN_API_URL = process.env.ADMIN_API_INTERNAL_URL || import.meta.env.PUBLIC_API_URL || "http://localhost:3001";

/**
 * Verifies an admin JWT by delegating to the admin-API `/api/auth/me` endpoint
 * (which runs `jwtVerify`). Fails closed on any error so a transient outage
 * blocks access rather than leaking reports.
 */
async function isValidAdminToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const res = await fetch(`${ADMIN_API_URL}/api/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Gates the sensitive reports (database schema, architecture map, test catalog).
 * They used to be anonymous static assets under `public/reports` (S3); they are
 * now served by the SSR endpoint at `/reports/[...file]` and only to a request
 * carrying a valid `admin_token` cookie. Everything else passes through.
 */
export const onRequest: MiddlewareHandler = async (context, next) => {
  if (context.url.pathname.startsWith("/reports/")) {
    const token = context.cookies.get("admin_token")?.value;
    if (!(await isValidAdminToken(token))) {
      return new Response("Unauthorized", { status: 401 });
    }
  }
  return next();
};
