import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import type { IncomingMessage } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { isPublicAddress, parseArticleUrl } from "./address-guard.js";
import { ArticleError } from "./errors.js";

export interface FetchedPage {
  /** Where the page ended up after redirects — relative links and the saved source resolve against it. */
  url: string;
  html: string;
}

export interface FetchPageOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

const DEFAULTS = { timeoutMs: 12_000, maxBytes: 4 * 1024 * 1024, maxRedirects: 5 };

// Many news sites serve a stripped or blocked page to an unknown agent; a
// browser-shaped one gets the article a reader would see.
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 PolyglotReader/1.0";

/**
 * Resolves through DNS and refuses private addresses at connect time, so a public
 * name that resolves (or re-resolves, DNS rebinding) to an internal IP never connects.
 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, "", 4);
    const list = Array.isArray(addresses) ? addresses : [];
    if (list.length === 0 || list.some((a) => !isPublicAddress(a.address))) {
      return callback(new ArticleError("blocked_host", "Resolves to a private address"), "", 4);
    }
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
    const first = list[0] as LookupAddress;
    callback(null, first.address, first.family);
  });
};

function charsetOf(contentType: string | undefined, head: Buffer): string {
  const fromHeader = /charset\s*=\s*"?([\w-]+)/i.exec(contentType ?? "")?.[1];
  if (fromHeader) return fromHeader;
  const sniff = head.subarray(0, 4096).toString("latin1");
  return /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(sniff)?.[1] ?? "utf-8";
}

function decode(body: Buffer, contentType: string | undefined): string {
  const charset = charsetOf(contentType, body);
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

function decompressed(response: IncomingMessage): NodeJS.ReadableStream {
  switch ((response.headers["content-encoding"] ?? "").trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return response.pipe(createGunzip());
    case "deflate":
      return response.pipe(createInflate());
    case "br":
      return response.pipe(createBrotliDecompress());
    default:
      return response;
  }
}

type Hop = { redirect: string } | { page: FetchedPage };

function fetchOnce(url: URL, options: Required<FetchPageOptions>, signal: AbortSignal): Promise<Hop> {
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        lookup: guardedLookup,
        signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "accept-encoding": "gzip, deflate, br",
          "accept-language": "*",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          return resolve({ redirect: new URL(response.headers.location, url).toString() });
        }
        if (status < 200 || status >= 300) {
          response.resume();
          return reject(new ArticleError("fetch_failed", `HTTP ${status}`));
        }
        const contentType = response.headers["content-type"];
        if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
          response.resume();
          return reject(new ArticleError("not_html", `Content-Type ${contentType}`));
        }
        const declared = Number(response.headers["content-length"] ?? 0);
        if (declared > options.maxBytes) {
          response.resume();
          return reject(new ArticleError("too_large", `Content-Length ${declared}`));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        const body = decompressed(response);
        body.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            req.destroy();
            reject(new ArticleError("too_large", "Body over the size cap"));
            return;
          }
          chunks.push(chunk);
        });
        body.on("error", (error) => reject(new ArticleError("fetch_failed", error.message)));
        body.on("end", () =>
          resolve({ page: { url: url.toString(), html: decode(Buffer.concat(chunks), contentType) } }),
        );
      },
    );
    req.on("error", (error) =>
      reject(error instanceof ArticleError ? error : new ArticleError("fetch_failed", error.message)),
    );
    req.end();
  });
}

/** GETs a public web page with the guards a user-supplied URL needs: no private hosts, a size cap, a deadline. */
export async function fetchPage(rawUrl: string, overrides: FetchPageOptions = {}): Promise<FetchedPage> {
  const options = { ...DEFAULTS, ...overrides };
  const signal = AbortSignal.timeout(options.timeoutMs);
  let url = parseArticleUrl(rawUrl);
  for (let hop = 0; hop <= options.maxRedirects; hop++) {
    let result: Hop;
    try {
      result = await fetchOnce(url, options, signal);
    } catch (error) {
      if (error instanceof ArticleError) throw error;
      throw new ArticleError("fetch_failed", error instanceof Error ? error.message : String(error));
    }
    if ("page" in result) return result.page;
    // Every hop is re-checked: a public page may redirect to an internal one.
    url = parseArticleUrl(result.redirect);
  }
  throw new ArticleError("fetch_failed", "Too many redirects");
}
