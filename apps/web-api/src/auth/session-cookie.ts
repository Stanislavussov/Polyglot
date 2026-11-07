import type { FastifyRequest } from "fastify";

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

// __Host- makes the browser refuse the cookie from any other subdomain, so a
// sibling site cannot plant a session that shadows the real one. The prefix
// demands Secure, so it only applies in production (local dev is plain http).
function cookieName(production: boolean): string {
  return production ? "__Host-learn_session" : "learn_session";
}

// SameSite=Strict holds: the widget calls a JS callback that POSTs same-origin,
// so the login never arrives as a cross-site navigation.
function attributes(production: boolean, maxAgeSeconds: number): string {
  return `Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${production ? "; Secure" : ""}`;
}

export function sessionCookie(token: string, production: boolean): string {
  return `${cookieName(production)}=${token}; ${attributes(production, SESSION_TTL_SECONDS)}`;
}

export function clearedSessionCookie(production: boolean): string {
  return `${cookieName(production)}=; ${attributes(production, 0)}`;
}

export function sessionToken(request: FastifyRequest, production: boolean): string | undefined {
  const name = cookieName(production);
  for (const pair of request.headers.cookie?.split(";") ?? []) {
    const separator = pair.indexOf("=");
    if (separator !== -1 && pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim() || undefined;
    }
  }
  return undefined;
}
