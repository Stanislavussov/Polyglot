import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { APIRoute } from "astro";

export const prerender = false;

/**
 * Directory holding the generated reports, moved out of `public/` so they are
 * no longer anonymous static assets (T09/S3). Configurable for prod, where the
 * admin server runs from the repo root; defaults to the dev layout (astro dev
 * runs from apps/admin).
 */
const REPORTS_DIR = process.env.REPORTS_DIR ? resolve(process.env.REPORTS_DIR) : resolve(process.cwd(), "reports-data");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

/**
 * Serves a single report file. Access is already gated by the auth middleware
 * (valid `admin_token` cookie); this route only resolves the file and guards
 * against path traversal so a request can never escape REPORTS_DIR.
 */
export const GET: APIRoute = async ({ params }) => {
  const rel = params.file ?? "";
  const target = resolve(REPORTS_DIR, rel);
  if (target !== REPORTS_DIR && !target.startsWith(REPORTS_DIR + sep)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const data = await readFile(target);
    const type = CONTENT_TYPES[extname(target)] ?? "application/octet-stream";
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: { "content-type": type, "cache-control": "private, no-store" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
};
