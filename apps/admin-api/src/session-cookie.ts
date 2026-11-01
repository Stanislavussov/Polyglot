import type { FastifyRequest } from "fastify";

// __Host- makes the browser refuse this cookie from any other subdomain, so a
// sibling site cannot plant an admin_token that shadows the real one. The prefix
// demands Secure, so it only applies where Secure does.
function cookieName(): string {
  return process.env.NODE_ENV === "production" ? "__Host-admin_token" : "admin_token";
}

export const SESSION_TTL_SECONDS = 24 * 60 * 60;

// HttpOnly keeps the token out of reach of any script on the panel, which is the
// point: in localStorage one XSS handed over a 24h admin session. SameSite=Strict
// holds because the panel and this API are subdomains of one site. Secure only in
// production — the local panel talks to http://localhost.
function attributes(maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${secure}`;
}

export function sessionCookie(token: string): string {
  return `${cookieName()}=${token}; ${attributes(SESSION_TTL_SECONDS)}`;
}

export function clearedSessionCookie(): string {
  return `${cookieName()}=; ${attributes(0)}`;
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const pair of header?.split(";") ?? []) {
    const separator = pair.indexOf("=");
    if (separator !== -1 && pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim() || undefined;
    }
  }
  return undefined;
}

/** The panel sends the cookie; the panel's own server and scripts send a Bearer header. */
export function sessionToken(request: FastifyRequest): string | undefined {
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? "")?.[1];
  return bearer ?? cookieValue(request.headers.cookie, cookieName());
}
