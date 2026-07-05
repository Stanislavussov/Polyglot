import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const DEFAULT_ROOTS = ["apps", "packages"];
const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;
const TEST_FUNCTIONS = new Set(["it", "test"]);

export function buildTestCatalogReport({ rootDir = process.cwd(), jsonOutputPath, htmlOutputPath } = {}) {
  const generatedAt = new Date().toISOString();
  const scenarios = collectTestCatalog(rootDir);
  const catalog = {
    generatedAt,
    summary: buildSummary(scenarios),
    scenarios,
  };
  const html = renderTestCatalogHtml({ catalog });

  if (jsonOutputPath) {
    mkdirSync(dirname(jsonOutputPath), { recursive: true });
    writeFileSync(jsonOutputPath, `${JSON.stringify(catalog, null, 2)}\n`);
  }

  if (htmlOutputPath) {
    mkdirSync(dirname(htmlOutputPath), { recursive: true });
    writeFileSync(htmlOutputPath, html);
  }

  return {
    slug: "test-catalog",
    title: "Polyglot Test Catalog",
    description: "Business-readable catalog of automated test coverage scenarios.",
    href: "/reports/test-catalog.html",
    dataHref: "/reports/test-catalog.json",
    scenarioCount: scenarios.length,
    catalog,
    html,
  };
}

export function collectTestCatalog(rootDir) {
  return DEFAULT_ROOTS.flatMap((root) => findTestFiles(join(rootDir, root)))
    .sort()
    .flatMap((filePath) => collectTestsFromFile({ filePath, rootDir }));
}

export function collectTestsFromSource({ sourceText, filePath = "sample.test.ts", rootDir = process.cwd() }) {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const relativePath = normalizePath(relative(rootDir, filePath));
  const tests = [];

  visitStatements(sourceFile.statements, []);

  return tests;

  function visitStatements(statements, suitePath) {
    for (const statement of statements) {
      visitNode(statement, suitePath);
    }
  }

  function visitNode(node, suitePath) {
    if (ts.isCallExpression(node)) {
      const callName = getCallName(node.expression);
      const title = getStringLiteralValue(node.arguments[0]);

      if (callName === "describe" && title) {
        const callback = findCallbackArgument(node.arguments);
        if (callback) {
          visitNode(callback.body, [...suitePath, title]);
          return;
        }
      }

      if (callName && TEST_FUNCTIONS.has(callName) && title) {
        const businessDescription = getBusinessDescription(sourceText, sourceFile, node);
        const sourceLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const packageName = getPackageName(relativePath);
        const generatedName = buildCoverageName({ packageName, suitePath, title });
        const generatedValue = buildCoverageValue({ packageName, suitePath, title });
        tests.push({
          id: buildScenarioId({ relativePath, suitePath, title, sourceLine }),
          kind: businessDescription ? "business" : "technical",
          filePath: relativePath,
          sourceLine,
          workspace: relativePath.split("/")[0] ?? "root",
          packageName,
          suitePath,
          title,
          rawTitle: title,
          name: businessDescription ? buildCoverageName({ packageName, suitePath, title }) : generatedName,
          value: businessDescription ?? generatedValue,
          description: businessDescription ?? generatedValue,
        });
      }
    }

    if (ts.isBlock(node) || ts.isSourceFile(node)) {
      visitStatements(node.statements, suitePath);
      return;
    }

    ts.forEachChild(node, (child) => visitNode(child, suitePath));
  }
}

export function renderTestCatalogHtml({ catalog }) {
  const groups = groupScenarios(catalog.scenarios);
  const rows = catalog.scenarios
    .map(
      (test, index) => `
        <tr class="${escapeHtml(test.kind)}">
          <td><a href="#scenario-${index + 1}">${escapeHtml(test.name)}</a></td>
          <td>${escapeHtml(test.kind)}</td>
          <td>${escapeHtml(test.suitePath.join(" > ") || "Root")}</td>
          <td><code>${escapeHtml(test.filePath)}</code></td>
        </tr>`,
    )
    .join("");

  const scenarioSections = groups
    .map(
      (group) => `
        <section class="group">
          <h2>${escapeHtml(group.name)} <span>${group.tests.length}</span></h2>
          ${group.tests
            .map(
              (test) => `
                <article id="scenario-${test.index}" class="scenario">
                  <div class="scenario-meta">
                    <strong>${escapeHtml(test.kind)}</strong>
                    <code>${escapeHtml(test.filePath)}</code>
                    <span>${escapeHtml(test.suitePath.join(" > ") || "Root")}</span>
                  </div>
                  <h3>${escapeHtml(test.name)}</h3>
                  <p>${escapeHtml(test.value)}</p>
                </article>`,
            )
            .join("")}
        </section>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Polyglot Test Catalog</title>
    <style>
      :root {
        color-scheme: light;
        --border: #d8dee8;
        --ink: #182033;
        --muted: #5f6c80;
        --panel: #ffffff;
        --surface: #f6f8fb;
        --accent: #2563eb;
      }

      body {
        margin: 0;
        background: var(--surface);
        color: var(--ink);
        font-family:
          Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.55;
      }

      header {
        border-bottom: 1px solid var(--border);
        background: var(--panel);
        padding: 32px min(6vw, 56px);
      }

      main {
        padding: 24px min(6vw, 56px) 56px;
      }

      h1 {
        margin: 0;
        font-size: clamp(2rem, 4vw, 3.25rem);
        line-height: 1.05;
      }

      h2 {
        align-items: baseline;
        display: flex;
        gap: 10px;
        margin: 34px 0 14px;
        font-size: 1.35rem;
      }

      h2 span {
        color: var(--muted);
        font-size: 0.9rem;
        font-weight: 600;
      }

      h3 {
        margin: 8px 0;
        font-size: 1.05rem;
      }

      p {
        margin: 0;
      }

      .summary {
        color: var(--muted);
        margin-top: 12px;
        max-width: 860px;
      }

      .stats {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 20px;
      }

      .stat,
      .scenario,
      table {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 8px;
      }

      .stat {
        padding: 10px 14px;
      }

      .stat strong {
        display: block;
        font-size: 1.35rem;
      }

      .stat span,
      .scenario-meta,
      .generated {
        color: var(--muted);
        font-size: 0.88rem;
      }

      table {
        border-collapse: separate;
        border-spacing: 0;
        margin-top: 24px;
        overflow: hidden;
        width: 100%;
      }

      th,
      td {
        border-bottom: 1px solid var(--border);
        padding: 10px 12px;
        text-align: left;
        vertical-align: top;
      }

      th {
        background: #eef2f7;
        font-size: 0.78rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
      }

      tr:last-child td {
        border-bottom: 0;
      }

      a {
        color: var(--accent);
        font-weight: 650;
        text-decoration: none;
      }

      code {
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
        font-size: 0.84em;
      }

      .scenario {
        margin-bottom: 10px;
        padding: 16px;
      }

      .scenario-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 14px;
      }

      @media (max-width: 760px) {
        table,
        thead,
        tbody,
        tr,
        th,
        td {
          display: block;
        }

        thead {
          display: none;
        }

        tr {
          border-bottom: 1px solid var(--border);
        }

        td {
          border-bottom: 0;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <p class="generated">Generated ${escapeHtml(catalog.generatedAt)}</p>
      <h1>Polyglot Test Catalog</h1>
      <p class="summary">
        Business-readable inventory of automated scenarios. Open a scenario to see the suite, source file, and the behavior it protects.
      </p>
      <div class="stats">
        <div class="stat"><strong>${catalog.summary.total}</strong><span>scenarios</span></div>
        <div class="stat"><strong>${catalog.summary.business}</strong><span>business</span></div>
        <div class="stat"><strong>${catalog.summary.technical}</strong><span>technical</span></div>
      </div>
    </header>
    <main>
      <table>
        <thead>
          <tr>
            <th>Scenario</th>
            <th>Kind</th>
            <th>Suite</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${scenarioSections}
    </main>
  </body>
</html>
`;
}

function collectTestsFromFile({ filePath, rootDir }) {
  return collectTestsFromSource({
    sourceText: readFileSync(filePath, "utf8"),
    filePath,
    rootDir,
  });
}

function findTestFiles(rootPath) {
  if (!pathExists(rootPath)) {
    return [];
  }

  const entries = readdirSync(rootPath, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".astro") {
        return [];
      }
      return findTestFiles(entryPath);
    }

    return TEST_FILE_PATTERN.test(entry.name) ? [entryPath] : [];
  });
}

function getCallName(expression) {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }

  if (ts.isPropertyAccessExpression(expression)) {
    if (ts.isIdentifier(expression.expression)) {
      return expression.expression.text;
    }
    return getCallName(expression.expression);
  }

  return undefined;
}

function getStringLiteralValue(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined;
}

function findCallbackArgument(args) {
  return args.find((arg) => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg));
}

function getBusinessDescription(sourceText, sourceFile, node) {
  const comments = ts.getLeadingCommentRanges(sourceText, node.getFullStart()) ?? [];
  const closest = comments.at(-1);
  if (!closest) {
    return undefined;
  }

  const commentEnd = sourceFile.getLineAndCharacterOfPosition(closest.end).line;
  const nodeStart = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
  if (nodeStart - commentEnd > 1) {
    return undefined;
  }

  const text = sourceText.slice(closest.pos, closest.end);
  return normalizeBusinessComment(text);
}

function normalizeBusinessComment(comment) {
  const lines = comment
    .replace(/^\/\*\*?/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*?\s?/, "").replace(/^\/\/\s?/, "").trim())
    .filter(Boolean);

  const businessLine = lines.find((line) => /^(@business|business:)/i.test(line));
  if (businessLine) {
    return businessLine.replace(/^@business\s*:?\s*/i, "").replace(/^business:\s*/i, "").trim();
  }

  return undefined;
}

function buildSummary(scenarios) {
  const business = scenarios.filter((scenario) => scenario.kind === "business").length;
  return {
    total: scenarios.length,
    business,
    technical: scenarios.length - business,
    workspaces: [...new Set(scenarios.map((scenario) => scenario.workspace))].sort(),
    packages: [...new Set(scenarios.map((scenario) => scenario.packageName))].sort(),
  };
}

function buildCoverageName({ packageName, suitePath, title }) {
  const area = getReadablePackageName(packageName);
  const suite = suitePath.map((part) => humanizeIdentifier(part)).join(" ");
  const behavior = humanizeIdentifier(title);

  return compactSentence([area, suite, behavior].filter(Boolean).join(" "));
}

function buildCoverageValue({ packageName, suitePath, title }) {
  const area = getReadablePackageName(packageName);
  const suite = suitePath.map((part) => humanizeIdentifier(part)).join(" ");
  const behavior = humanizeIdentifier(title);
  const context = [area, suite].filter(Boolean).join(" ");
  const readableContext = context ? `the ${lowerInitial(context)}` : "this";

  if (startsWithVerbPhrase(behavior)) {
    return compactSentence(`Protects ${readableContext} behavior: ${behavior}.`);
  }

  return compactSentence(`Protects ${readableContext} behavior so ${behavior}.`);
}

function getReadablePackageName(packageName) {
  const labels = {
    admin: "Admin UI",
    "admin-api": "Admin API",
    bot: "Bot",
    core: "Core domain",
    infra: "Infrastructure",
    "translation-benchmark": "Translation benchmark",
    "adapters/ai": "AI adapter",
    "adapters/db": "Database adapter",
    "adapters/notifications": "Notification adapter",
    "adapters/youtube": "YouTube adapter",
  };

  return labels[packageName] ?? humanizeIdentifier(packageName);
}

function humanizeIdentifier(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function startsWithVerbPhrase(value) {
  return /^(accepts|adds|allows|applies|builds|calculates|calls|classifies|closes|converts|creates|deduplicates|defaults|detects|does|escapes|excludes|extracts|falls|filters|finds|formats|generates|handles|hides|ignores|includes|keeps|limits|loads|logs|maps|marks|normalizes|omits|parses|persists|preserves|prevents|processes|records|rejects|renders|reports|requires|resolves|respects|returns|routes|saves|selects|sends|shows|skips|sorts|stores|strips|throws|tracks|translates|updates|uses|validates)\b/i.test(
    value,
  );
}

function compactSentence(value) {
  const sentence = value.replace(/\s+/g, " ").replace(/\s+([.,:])/g, "$1").trim();
  return sentence ? `${sentence[0]?.toUpperCase() ?? ""}${sentence.slice(1)}` : sentence;
}

function lowerInitial(value) {
  return value ? `${value[0]?.toLowerCase() ?? ""}${value.slice(1)}` : value;
}

function buildScenarioId({ relativePath, suitePath, title, sourceLine }) {
  return slugify([relativePath, sourceLine, ...suitePath, title].join(" "));
}

function getPackageName(relativePath) {
  const parts = relativePath.split("/");
  if (parts[0] === "apps") {
    return parts[1] ?? "apps";
  }

  if (parts[0] === "packages" && parts[1] === "adapters") {
    return parts[2] ? `adapters/${parts[2]}` : "adapters";
  }

  if (parts[0] === "packages") {
    return parts[1] ?? "packages";
  }

  return parts[0] ?? "root";
}

function slugify(value) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || "scenario";
}

function groupScenarios(tests) {
  const indexedTests = tests.map((test, index) => ({ ...test, index: index + 1 }));
  const groupMap = new Map();

  for (const test of indexedTests) {
    const group = groupMap.get(test.workspace) ?? [];
    group.push(test);
    groupMap.set(test.workspace, group);
  }

  return [...groupMap.entries()].map(([name, groupTests]) => ({ name, tests: groupTests }));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizePath(path) {
  return path.split("\\").join("/");
}

function pathExists(path) {
  try {
    statSync(path);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

const scriptPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;

if (import.meta.url === scriptPath) {
  const rootDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(rootDir, "..");
  // Non-public dir: served via the cookie-gated Astro endpoint, not statically (T09/S3).
  const reportsDir = join(repoRoot, "apps/admin/reports-data");
  const jsonOutputPath = join(reportsDir, "test-catalog.json");
  const htmlOutputPath = join(reportsDir, "test-catalog.html");
  const report = buildTestCatalogReport({ rootDir: repoRoot, jsonOutputPath, htmlOutputPath });

  process.stdout.write(`Generated ${basename(jsonOutputPath)} with ${report.scenarioCount} test scenarios.\n`);
}
