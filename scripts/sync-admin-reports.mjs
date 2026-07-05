import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { buildTestCatalogReport } from "./test-catalog.mjs";

const sourceDir = join(process.cwd(), "@docs/reports");
// Non-public dir: reports are served through the cookie-gated Astro endpoint
// (src/pages/reports/[...file].ts), never as anonymous static assets (T09/S3).
const targetDir = join(process.cwd(), "apps/admin/reports-data");

const descriptions = {
  "architecture-overview": "High-level product and system architecture map for the Polyglot platform.",
  "database-schema": "Generated database relationship map with table descriptions, fields, indexes, usage, and optimization notes.",
  observability: "Operational observability report covering metrics, dashboards, logging, and runtime monitoring.",
  "translation-quality-report": "Translation quality evaluation report with benchmark results and quality findings.",
  "translation-quality-roadmap": "Roadmap for improving translation quality, validation, benchmarking, and model routing.",
  "payments-architecture":
    "Architecture plan for integrating recurring payments (Telegram Stars first, Mollie/fiat as an optional web channel), with a subscription state machine, ledger design, and a 24-item pitfalls register.",
};

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });

const reports = readdirSync(sourceDir)
  .filter((fileName) => fileName.endsWith(".html"))
  .sort()
  .map((fileName) => {
    const sourcePath = join(sourceDir, fileName);
    const slug = basename(fileName, ".html");
    const targetPath = join(targetDir, fileName);
    const html = readFileSync(sourcePath, "utf8");
    const title = extractTitle(html) ?? titleFromSlug(slug);

    copyFileSync(sourcePath, targetPath);

    return {
      slug,
      title,
      description: descriptions[slug] ?? `HTML architecture report generated from ${fileName}.`,
      href: `/reports/${fileName}`,
    };
  });

const testCatalogReport = buildTestCatalogReport({
  rootDir: process.cwd(),
  jsonOutputPath: join(targetDir, "test-catalog.json"),
  htmlOutputPath: join(targetDir, "test-catalog.html"),
});

writeFileSync(join(targetDir, "manifest.json"), `${JSON.stringify({ reports }, null, 2)}\n`);
process.stdout.write(
  `Synced ${reports.length} admin architecture reports and ${testCatalogReport.scenarioCount} test scenarios to apps/admin/public/reports.\n`,
);

function extractTitle(html) {
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (!titleMatch) {
    return undefined;
  }

  return decodeHtml(titleMatch[1].trim());
}

function titleFromSlug(slug) {
  return slug
    .split("-")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}
