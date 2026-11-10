import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

/**
 * CSP hashes of the inline scripts Astro emits (island hydration). Allowing these
 * exact bodies keeps `script-src` free of 'unsafe-inline', so an injected script
 * still cannot run. Computed once from the built files the server is about to serve.
 */
export function inlineScriptHashes(staticDir: string): string[] {
  const hashes = new Set<string>();
  for (const file of htmlFiles(staticDir)) {
    for (const match of readFileSync(file, "utf8").matchAll(INLINE_SCRIPT)) {
      hashes.add(
        `'sha256-${createHash("sha256")
          .update(match[1] ?? "")
          .digest("base64")}'`,
      );
    }
  }
  return [...hashes];
}
