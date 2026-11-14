import { BlockList, isIP } from "node:net";
import { ArticleError } from "./errors.js";

// The server fetches a URL a user typed, so a link must never reach the host's own
// network (metadata endpoints, the database, the admin API on localhost).
const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 6) {
    // An IPv4-mapped IPv6 address (::ffff:10.0.0.1) reaches the IPv4 host behind it.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped?.[1]) return isPublicAddress(mapped[1]);
    return !blocked.check(address, "ipv6");
  }
  return !blocked.check(address, "ipv4");
}

const ALLOWED_PORTS = new Set(["", "80", "443"]);

/** Parses a user-typed link; anything but a plain public http(s) URL is refused before a socket opens. */
export function parseArticleUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
  } catch {
    throw new ArticleError("invalid_url", "Not a URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ArticleError("invalid_url", "Not http(s)");
  if (url.username || url.password) throw new ArticleError("invalid_url", "Credentials in URL");
  if (!ALLOWED_PORTS.has(url.port)) throw new ArticleError("blocked_host", "Non-standard port");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new ArticleError("blocked_host", "Local host name");
  }
  if (!host.includes(".") && isIP(host) === 0) throw new ArticleError("invalid_url", "Not a public host name");
  if (isIP(host) !== 0 && !isPublicAddress(host)) throw new ArticleError("blocked_host", "Private address");
  url.hash = "";
  return url;
}
