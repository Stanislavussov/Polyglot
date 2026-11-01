import type { APIRoute } from "astro";

/**
 * Server-to-server admin-API base URL used to verify admin tokens.
 * In prod the admin container reaches admin-api over the compose network
 * (`http://admin-api:3001`); in dev it falls back to localhost.
 */
const ADMIN_API_URL = process.env.ADMIN_API_INTERNAL_URL || import.meta.env.PUBLIC_API_URL || "http://localhost:3001";

// __Host- stops a sibling subdomain from planting a cookie of the same name that
// shadows this one. The prefix demands Secure, which the local http panel lacks.
export const PANEL_SESSION_COOKIE = import.meta.env.PROD ? "__Host-admin_token" : "admin_token";

// Junk is turned away here instead of costing a call to the admin API.
const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/;
const SESSION_TTL_SECONDS = 24 * 60 * 60;

/**
 * Verifies an admin JWT by delegating to the admin-API `/api/auth/me` endpoint
 * (which runs `jwtVerify`). Fails closed on any error so a transient outage
 * blocks access rather than leaking reports.
 *
 * `forwardedFor` is the X-Forwarded-For nginx sent this server. Passed on, the
 * API's rate limit counts the real client rather than this server, whose single
 * bucket a flood of junk tokens used to drain for every admin.
 */
export async function isValidAdminToken(token: string | undefined, forwardedFor: string | null): Promise<boolean> {
  if (!token || !JWT_SHAPE.test(token)) return false;
  try {
    const res = await fetch(`${ADMIN_API_URL}/api/auth/me`, {
      headers: { authorization: `Bearer ${token}`, ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}) },
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function tokenFrom(request: Request): Promise<string | undefined> {
  // JSON only: a cross-site page can POST text/plain without a CORS preflight.
  if (!request.headers.get("content-type")?.startsWith("application/json")) return undefined;
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || !("token" in body)) return undefined;
  return typeof body.token === "string" ? body.token : undefined;
}

export const createSession: APIRoute = async ({ request, cookies }) => {
  const token = await tokenFrom(request);
  if (!token || !(await isValidAdminToken(token, request.headers.get("x-forwarded-for")))) {
    return new Response(null, { status: 401 });
  }
  // The proxy terminates TLS, so the request URL here is always http://; a
  // production build is what says the panel is served over HTTPS.
  cookies.set(PANEL_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: import.meta.env.PROD,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return new Response(null, { status: 204 });
};

export const endSession: APIRoute = ({ cookies }) => {
  cookies.delete(PANEL_SESSION_COOKIE, { path: "/" });
  return new Response(null, { status: 204 });
};
