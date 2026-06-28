import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";
import * as schema from "./schema.js";

type DrizzleTable = Parameters<typeof getTableName>[0];

type Column = {
  propertyName: string;
  name: string;
  type: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  defaulted: boolean;
};

type ForeignKey = {
  columns: string[];
  targetTable: string;
  targetColumns: string[];
  onDelete: string;
  onUpdate: string;
};

type DbIndex = {
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
};

type Usage = {
  directMentions: number;
  files: string[];
};

type TableReport = {
  exportName: string;
  name: string;
  description: string;
  columns: Column[];
  foreignKeys: ForeignKey[];
  indexes: DbIndex[];
  inbound: ForeignKey[];
  usage: Usage;
  notes: string[];
};

type GraphNode = {
  id: string;
  label: string;
  group: string;
  columns: number;
};

type GraphEdge = {
  from: string;
  to: string;
  label: string;
  onDelete: string;
};

type UnknownRecord = Record<string, unknown>;

const repoRoot = findRepoRoot(process.cwd());
const outputPath = join(repoRoot, "@docs/reports/database-schema.html");
const scanRoots = [join(repoRoot, "apps"), join(repoRoot, "packages")];

const symbolName = {
  columns: "Symbol(drizzle:Columns)",
  extraConfigBuilder: "Symbol(drizzle:ExtraConfigBuilder)",
  extraConfigColumns: "Symbol(drizzle:ExtraConfigColumns)",
  inlineForeignKeys: "Symbol(drizzle:PgInlineForeignKeys)",
  isTable: "Symbol(drizzle:IsDrizzleTable)",
} as const;

const tables = collectTables();
const usages = collectUsage(tables.map((table) => table.exportName));
const descriptions = collectTableDescriptions();
const reports = buildTableReports(tables, usages, descriptions);
const html = renderHtml(reports);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, html);
process.stdout.write(`Generated ${relative(repoRoot, outputPath)} from ${tables.length} Drizzle tables.\n`);

function findRepoRoot(start: string): string {
  let current = resolve(start);

  while (current !== dirname(current)) {
    const packageJsonPath = join(current, "package.json");
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { workspaces?: unknown };
      if (Array.isArray(packageJson.workspaces)) {
        return current;
      }
    } catch {
      // Keep walking upward until the workspace root is found.
    }
    current = dirname(current);
  }

  throw new Error("Could not locate repository root package.json with workspaces.");
}

function collectTables(): { exportName: string; table: DrizzleTable }[] {
  return Object.entries(schema)
    .filter((entry): entry is [string, DrizzleTable] => isDrizzleTable(entry[1]))
    .map(([exportName, table]) => ({ exportName, table }))
    .sort((left, right) => getTableName(left.table).localeCompare(getTableName(right.table)));
}

function isDrizzleTable(value: unknown): value is DrizzleTable {
  return isRecord(value) && getSymbolValue(value, symbolName.isTable) === true;
}

function buildTableReports(
  tableEntries: { exportName: string; table: DrizzleTable }[],
  tableUsages: Map<string, Usage>,
  tableDescriptions: Map<string, string>,
): TableReport[] {
  const baseReports = tableEntries.map(({ exportName, table }) => {
    const name = getTableName(table);
    const columns = collectColumns(table);
    const foreignKeys = collectForeignKeys(table);
    const indexes = collectIndexes(table);

    return {
      exportName,
      name,
      description: tableDescriptions.get(exportName) ?? fallbackDescription(name),
      columns,
      foreignKeys,
      indexes,
      inbound: [],
      usage: tableUsages.get(exportName) ?? { directMentions: 0, files: [] },
      notes: [],
    };
  });

  const byName = new Map(baseReports.map((report) => [report.name, report]));
  for (const report of baseReports) {
    for (const foreignKey of report.foreignKeys) {
      byName.get(foreignKey.targetTable)?.inbound.push({
        ...foreignKey,
        targetTable: report.name,
        targetColumns: foreignKey.columns,
        columns: foreignKey.targetColumns,
      });
    }
  }

  for (const report of baseReports) {
    report.notes = buildNotes(report);
  }

  return baseReports;
}

function collectColumns(table: DrizzleTable): Column[] {
  return Object.entries(getTableColumns(table)).map(([propertyName, rawColumn]) => {
    const column = toRecord(rawColumn);
    return {
      propertyName,
      name: String(column.name),
      type: String(column.columnType ?? "unknown"),
      dataType: String(column.dataType ?? "unknown"),
      nullable: column.notNull !== true,
      primaryKey: column.primary === true,
      unique: column.isUnique === true,
      defaulted: column.hasDefault === true,
    };
  });
}

function collectForeignKeys(table: DrizzleTable): ForeignKey[] {
  const rawForeignKeys = getSymbolValue(table, symbolName.inlineForeignKeys);
  if (!Array.isArray(rawForeignKeys)) {
    return [];
  }

  return rawForeignKeys.map((rawForeignKey) => {
    const foreignKey = toRecord(rawForeignKey);
    const reference = foreignKey.reference;
    if (typeof reference !== "function") {
      throw new Error(`Foreign key on ${getTableName(table)} does not expose a reference function.`);
    }

    const referenced = toRecord(reference());
    const foreignTable = referenced.foreignTable;
    if (!isDrizzleTable(foreignTable)) {
      throw new Error(`Foreign key on ${getTableName(table)} does not reference a Drizzle table.`);
    }

    return {
      columns: toColumnNames(referenced.columns),
      targetTable: getTableName(foreignTable),
      targetColumns: toColumnNames(referenced.foreignColumns),
      onDelete: String(foreignKey.onDelete ?? "no action"),
      onUpdate: String(foreignKey.onUpdate ?? "no action"),
    };
  });
}

function collectIndexes(table: DrizzleTable): DbIndex[] {
  const extraConfigBuilder = getSymbolValue(table, symbolName.extraConfigBuilder);
  const extraConfigColumns = getSymbolValue(table, symbolName.extraConfigColumns);
  if (typeof extraConfigBuilder !== "function") {
    return collectInlineUniqueIndexes(table);
  }

  const builtConfigs = extraConfigBuilder(extraConfigColumns);
  if (!Array.isArray(builtConfigs)) {
    return collectInlineUniqueIndexes(table);
  }

  const configured = builtConfigs.flatMap((rawConfig): DbIndex[] => {
    const config = toRecord(rawConfig);
    const constructorName = isRecord(rawConfig) ? rawConfig.constructor.name : "";

    if (constructorName === "PrimaryKeyBuilder") {
      return [
        {
          name: String(config.name ?? "primary_key"),
          columns: toColumnNames(config.columns),
          unique: true,
          primary: true,
        },
      ];
    }

    const indexConfig = toRecord(config.config);
    if (!Array.isArray(indexConfig.columns)) {
      return [];
    }

    return [
      {
        name: String(indexConfig.name ?? "unnamed_index"),
        columns: toColumnNames(indexConfig.columns),
        unique: indexConfig.unique === true,
        primary: false,
      },
    ];
  });

  return [...collectInlineUniqueIndexes(table), ...configured].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function collectInlineUniqueIndexes(table: DrizzleTable): DbIndex[] {
  return collectColumns(table)
    .filter((column) => column.unique || column.primaryKey)
    .map((column) => ({
      name: column.primaryKey ? `${getTableName(table)}_primary_key` : `${getTableName(table)}_${column.name}_unique`,
      columns: [column.name],
      unique: true,
      primary: column.primaryKey,
    }));
}

function collectUsage(exportNames: string[]): Map<string, Usage> {
  const sourceFiles = scanRoots.flatMap((root) => collectSourceFiles(root));
  const usage = new Map(exportNames.map((exportName) => [exportName, { directMentions: 0, files: [] }]));

  for (const filePath of sourceFiles) {
    if (filePath.endsWith("/schema.ts") || filePath.endsWith("/index.ts") || filePath.endsWith("/schema-report.ts")) {
      continue;
    }

    const content = readFileSync(filePath, "utf8");
    for (const exportName of exportNames) {
      const matches = content.match(new RegExp(`\\b${escapeRegExp(exportName)}\\b`, "g"));
      if (!matches) {
        continue;
      }

      const currentUsage = usage.get(exportName);
      if (!currentUsage) {
        continue;
      }

      currentUsage.directMentions += matches.length;
      currentUsage.files.push(relative(repoRoot, filePath));
    }
  }

  return usage;
}

function collectTableDescriptions(): Map<string, string> {
  const schemaPath = join(repoRoot, "packages/adapters/db/src/schema.ts");
  const content = readFileSync(schemaPath, "utf8");
  const descriptions = new Map<string, string>();
  const tableDeclarationPattern = /((?:\/\/[^\n]*\n|\s|\/\*[\s\S]*?\*\/)*?)export const (\w+) = pgTable/g;
  let match = tableDeclarationPattern.exec(content);

  while (match) {
    const [, leadingText, exportName] = match;
    const description = normalizeSchemaComment(leadingText);
    if (description) {
      descriptions.set(exportName, description);
    }
    match = tableDeclarationPattern.exec(content);
  }

  return descriptions;
}

function normalizeSchemaComment(value: string): string {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("//") || line.startsWith("*") || line.startsWith("/*"))
    .map((line) =>
      line
        .replace(/^\/\/\s?/, "")
        .replace(/^\/\*\*?\s?/, "")
        .replace(/^\*\s?/, "")
        .replace(/\*\/$/, "")
        .trim(),
    )
    .filter((line) => line.length > 0 && !line.startsWith("─"));

  return lines.join(" ").replace(/\s+/g, " ").trim();
}

function fallbackDescription(tableName: string): string {
  const readable = tableName.replaceAll("_", " ");
  if (tableName.includes("vocabulary")) {
    return `Stores ${readable} data used by the personal dictionary, flashcard, and spaced-repetition flows.`;
  }
  if (tableName.includes("translation")) {
    return `Stores ${readable} data used to track translation requests, generated output configuration, or translation analytics.`;
  }
  if (tableName.includes("language")) {
    return `Stores ${readable} data used to resolve language metadata, user language preferences, or language-detection outcomes.`;
  }
  if (tableName.includes("video")) {
    return `Stores ${readable} data for the video vocabulary workflow, including processing state, extracted phrases, or transcript reuse.`;
  }
  if (tableName.includes("ai_")) {
    return `Stores ${readable} data for AI model administration, access control, or adapter observability.`;
  }

  return `Stores ${readable} records for the Polyglot application domain.`;
}

function collectSourceFiles(root: string): string[] {
  const entries = readdirSync(root);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(root, entry);
    if (fullPath.includes("/node_modules/") || fullPath.includes("/dist/")) {
      continue;
    }

    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    if (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}

function buildNotes(report: TableReport): string[] {
  const notes: string[] = [];
  const indexedColumns = new Set(report.indexes.flatMap((index) => index.columns));
  const foreignKeyColumns = report.foreignKeys.flatMap((foreignKey) => foreignKey.columns);
  const unindexedForeignKeys = foreignKeyColumns.filter((columnName) => !indexedColumns.has(columnName));
  const languageTextColumns = report.columns.filter(
    (column) =>
      column.type === "PgText" &&
      /(language|lang|langs)$/.test(column.propertyName) &&
      !foreignKeyColumns.includes(column.name),
  );

  if (unindexedForeignKeys.length > 0) {
    notes.push(`FK columns without explicit index: ${unindexedForeignKeys.join(", ")}.`);
  }

  if (languageTextColumns.length > 0) {
    notes.push(`Language stored as text, not FK: ${languageTextColumns.map((column) => column.name).join(", ")}.`);
  }

  if (report.foreignKeys.length === 0 && report.inbound.length === 0) {
    notes.push("Standalone table: no declared FK in or out.");
  }

  if (report.usage.directMentions === 0) {
    notes.push("No direct table-symbol usage found outside schema/index/report files.");
  } else if (report.usage.files.length <= 1) {
    notes.push("Low direct table-symbol usage; check whether this is new, admin-only, or dead weight.");
  }

  if (
    report.columns.some((column) => column.name.endsWith("_at")) &&
    !report.columns.some((column) => column.name === "updated_at")
  ) {
    notes.push("Has timestamp columns but no updated_at column.");
  }

  return notes;
}

function renderHtml(reports: TableReport[]): string {
  const relationRows = reports
    .flatMap((report) =>
      report.foreignKeys.map(
        (foreignKey) => `<tr>
          <td><a href="#${escapeAttribute(report.name)}">${escapeHtml(report.name)}</a></td>
          <td>${escapeHtml(foreignKey.columns.join(", "))}</td>
          <td><a href="#${escapeAttribute(foreignKey.targetTable)}">${escapeHtml(foreignKey.targetTable)}</a></td>
          <td>${escapeHtml(foreignKey.targetColumns.join(", "))}</td>
          <td>${escapeHtml(foreignKey.onDelete)}</td>
        </tr>`,
      ),
    )
    .join("\n");

  const graphData = buildGraphData(reports);
  const tableCards = reports.map(renderTableCard).join("\n");
  const totalColumns = reports.reduce((sum, report) => sum + report.columns.length, 0);
  const totalForeignKeys = reports.reduce((sum, report) => sum + report.foreignKeys.length, 0);
  const totalIndexes = reports.reduce((sum, report) => sum + report.indexes.length, 0);
  const generatedAt = new Date().toISOString();

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Polyglot Database Schema</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fa;
      --panel: #ffffff;
      --ink: #17202a;
      --muted: #5f6c7b;
      --line: #d9e0e8;
      --accent: #146c5f;
      --accent-soft: #dff3ef;
      --warn: #8a4b08;
      --warn-soft: #fff2d8;
      --code: #263544;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      padding: 32px 40px 20px;
      background: #0f2f2b;
      color: white;
    }
    header p { max-width: 980px; color: #d3e5e1; }
    main { padding: 24px 40px 48px; }
    h1, h2, h3 { margin: 0; line-height: 1.2; }
    h2 { margin: 28px 0 12px; }
    h3 { font-size: 18px; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .meta { color: var(--muted); font-size: 13px; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin: 20px 0 0;
      max-width: 780px;
    }
    .stat {
      background: rgba(255,255,255,.11);
      border: 1px solid rgba(255,255,255,.18);
      border-radius: 8px;
      padding: 12px;
    }
    .stat strong { display: block; font-size: 24px; }
    .toolbar {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
      margin-bottom: 18px;
    }
    input {
      min-width: min(420px, 100%);
      padding: 10px 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      font: inherit;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    th, td {
      padding: 8px 10px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #eef3f6;
      color: #344552;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    tr:last-child td { border-bottom: 0; }
    code {
      color: var(--code);
      background: #eef3f6;
      border-radius: 4px;
      padding: 1px 4px;
    }
    .table-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      margin: 14px 0;
      overflow: hidden;
    }
    .table-head {
      display: flex;
      gap: 12px;
      justify-content: space-between;
      padding: 16px;
      border-bottom: 1px solid var(--line);
    }
    .table-body { padding: 0 16px 16px; }
    .badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: #0f5148;
      font-size: 12px;
      white-space: nowrap;
    }
    .note {
      margin: 10px 0;
      padding: 10px 12px;
      background: var(--warn-soft);
      border: 1px solid #f2d7a5;
      border-radius: 6px;
      color: var(--warn);
    }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(280px, 420px);
      gap: 16px;
      align-items: start;
    }
    .small { font-size: 12px; color: var(--muted); }
    .relationship-map {
      position: relative;
      height: 720px;
      overflow: auto;
      background:
        linear-gradient(90deg, rgba(15,47,43,.05) 1px, transparent 1px),
        linear-gradient(0deg, rgba(15,47,43,.05) 1px, transparent 1px),
        #ffffff;
      background-size: 32px 32px;
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .relationship-map svg {
      display: block;
      min-width: 980px;
      width: max(100%, 980px);
      height: 100%;
    }
    .map-node rect {
      fill: #ffffff;
      stroke: #9fb2bf;
      stroke-width: 1.2;
      rx: 8;
    }
    .map-node text {
      fill: var(--ink);
      font-size: 12px;
      font-weight: 650;
      pointer-events: none;
    }
    .map-node .sub {
      fill: var(--muted);
      font-size: 10px;
      font-weight: 500;
    }
    .map-edge {
      stroke: #78909c;
      stroke-width: 1.3;
      opacity: .62;
      marker-end: url(#arrow);
    }
    .map-label {
      fill: #40515e;
      font-size: 10px;
      paint-order: stroke;
      stroke: #ffffff;
      stroke-width: 4px;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .legend {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin: 10px 0 16px;
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--muted);
      font-size: 12px;
    }
    .legend-swatch {
      width: 12px;
      height: 12px;
      border-radius: 3px;
      border: 1px solid rgba(0,0,0,.15);
    }
    @media (max-width: 980px) {
      header, main { padding-left: 16px; padding-right: 16px; }
      .grid { grid-template-columns: 1fr; }
      .table-head { flex-direction: column; }
      .relationship-map { height: 620px; }
      .relationship-map svg {
        min-width: 1120px;
        width: 1120px;
      }
      th, td { padding: 7px 8px; }
    }
    @media (max-width: 560px) {
      header { padding-top: 24px; }
      main { padding-top: 16px; }
      .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .stat strong { font-size: 20px; }
      .relationship-map {
        height: 560px;
        margin-left: -16px;
        margin-right: -16px;
        border-left: 0;
        border-right: 0;
        border-radius: 0;
      }
      .relationship-map svg {
        min-width: 1160px;
        width: 1160px;
      }
      .map-node text { font-size: 11px; }
      .map-node .sub { font-size: 9px; }
      table { display: block; overflow-x: auto; }
      tbody, thead { min-width: 620px; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Polyglot Database Schema</h1>
    <p>Generated from <code>packages/adapters/db/src/schema.ts</code>. Re-run <code>pnpm db:schema:report</code> after schema changes to refresh this file.</p>
    <div class="stats">
      <div class="stat"><strong>${reports.length}</strong>tables</div>
      <div class="stat"><strong>${totalColumns}</strong>columns</div>
      <div class="stat"><strong>${totalForeignKeys}</strong>foreign keys</div>
      <div class="stat"><strong>${totalIndexes}</strong>indexes / unique constraints</div>
    </div>
  </header>
  <main>
    <p class="meta">Generated at ${escapeHtml(generatedAt)}. Usage counts scan TypeScript files under <code>apps/</code> and <code>packages/</code>, excluding schema, index, and this report generator.</p>
    <section>
      <h2>Relationship Map</h2>
      <p class="meta">This SVG map is drawn from declared Drizzle foreign keys. Drag nodes to inspect dense areas.</p>
      ${renderLegend(graphData.nodes)}
      <div class="relationship-map" id="relationship-map"></div>
    </section>
    <section>
      <h2>Relations</h2>
      <table>
        <thead><tr><th>From table</th><th>Columns</th><th>To table</th><th>Target columns</th><th>On delete</th></tr></thead>
        <tbody>${relationRows}</tbody>
      </table>
    </section>
    <section>
      <h2>Tables</h2>
      <div class="toolbar">
        <input id="filter" type="search" placeholder="Filter tables, columns, notes, usage...">
        <span class="small">Client-side filter. The data itself is static HTML generated from the current schema.</span>
      </div>
      <div id="tables">${tableCards}</div>
    </section>
  </main>
  <script type="application/json" id="schema-graph-data">${escapeScriptJson(JSON.stringify(graphData))}</script>
  <script>
    const groupColors = {
      core: "#dff3ef",
      vocabulary: "#e8eefc",
      translation: "#fff2d8",
      admin: "#ece5f7",
      observability: "#e6f1f7",
      video: "#fde8df",
      cache: "#eaf3df",
      system: "#eef3f6"
    };
    const graphData = JSON.parse(document.querySelector("#schema-graph-data").textContent);
    const map = document.querySelector("#relationship-map");
    const width = Math.max(980, map.scrollWidth, map.clientWidth);
    const height = map.clientHeight;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", \`0 0 \${width} \${height}\`);
    svg.innerHTML = \`
      <defs>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L7,3 z" fill="#78909c"></path>
        </marker>
      </defs>
    \`;
    map.appendChild(svg);
    const groupSlots = {
      core: [width * .18, height * .22],
      vocabulary: [width * .42, height * .38],
      translation: [width * .72, height * .28],
      admin: [width * .20, height * .72],
      observability: [width * .72, height * .68],
      video: [width * .50, height * .72],
      cache: [width * .50, height * .16],
      system: [width * .84, height * .50]
    };
    const nodes = graphData.nodes.map((node, index) => {
      const slot = groupSlots[node.group] || groupSlots.system;
      return {
        ...node,
        x: slot[0] + ((index % 5) - 2) * 36,
        y: slot[1] + (Math.floor(index / 5) % 4 - 1.5) * 32,
        vx: 0,
        vy: 0
      };
    });
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const edges = graphData.edges.map((edge) => ({ ...edge, fromNode: byId.get(edge.from), toNode: byId.get(edge.to) }));
    const edgeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const labelLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const nodeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    svg.append(edgeLayer, labelLayer, nodeLayer);
    for (const edge of edges) {
      edge.path = document.createElementNS("http://www.w3.org/2000/svg", "line");
      edge.path.setAttribute("class", "map-edge");
      edge.labelNode = document.createElementNS("http://www.w3.org/2000/svg", "text");
      edge.labelNode.setAttribute("class", "map-label");
      edge.labelNode.textContent = edge.label;
      edgeLayer.appendChild(edge.path);
      labelLayer.appendChild(edge.labelNode);
    }
    for (const node of nodes) {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", "map-node");
      g.style.cursor = "grab";
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("width", "148");
      rect.setAttribute("height", "48");
      rect.setAttribute("x", "-74");
      rect.setAttribute("y", "-24");
      rect.setAttribute("fill", groupColors[node.group] || groupColors.system);
      const title = document.createElementNS("http://www.w3.org/2000/svg", "text");
      title.setAttribute("text-anchor", "middle");
      title.setAttribute("y", "-3");
      title.textContent = node.label;
      const sub = document.createElementNS("http://www.w3.org/2000/svg", "text");
      sub.setAttribute("class", "sub");
      sub.setAttribute("text-anchor", "middle");
      sub.setAttribute("y", "15");
      sub.textContent = \`\${node.group} - \${node.columns} cols\`;
      g.append(rect, title, sub);
      node.element = g;
      nodeLayer.appendChild(g);
      g.addEventListener("pointerdown", (event) => {
        node.dragging = true;
        g.setPointerCapture(event.pointerId);
        g.style.cursor = "grabbing";
      });
      g.addEventListener("pointermove", (event) => {
        if (!node.dragging) return;
        const point = svg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        const local = point.matrixTransform(svg.getScreenCTM().inverse());
        node.x = local.x;
        node.y = local.y;
        node.vx = 0;
        node.vy = 0;
        renderGraph();
      });
      g.addEventListener("pointerup", (event) => {
        node.dragging = false;
        g.releasePointerCapture(event.pointerId);
        g.style.cursor = "grab";
      });
    }
    for (let tick = 0; tick < 260; tick++) {
      stepGraph();
    }
    renderGraph();
    function stepGraph() {
      for (const node of nodes) {
        if (node.dragging) continue;
        const slot = groupSlots[node.group] || groupSlots.system;
        node.vx += (slot[0] - node.x) * .0022;
        node.vy += (slot[1] - node.y) * .0022;
      }
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const left = nodes[i];
          const right = nodes[j];
          const dx = right.x - left.x || .01;
          const dy = right.y - left.y || .01;
          const distSq = dx * dx + dy * dy;
          const force = Math.min(2.6, 5200 / distSq);
          left.vx -= dx * force * .018;
          left.vy -= dy * force * .018;
          right.vx += dx * force * .018;
          right.vy += dy * force * .018;
        }
      }
      for (const edge of edges) {
        const source = edge.fromNode;
        const target = edge.toNode;
        if (!source || !target) continue;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        source.vx += dx * .0018;
        source.vy += dy * .0018;
        target.vx -= dx * .0018;
        target.vy -= dy * .0018;
      }
      for (const node of nodes) {
        if (node.dragging) continue;
        node.vx *= .86;
        node.vy *= .86;
        node.x = Math.max(82, Math.min(width - 82, node.x + node.vx));
        node.y = Math.max(34, Math.min(height - 34, node.y + node.vy));
      }
    }
    function renderGraph() {
      for (const edge of edges) {
        const source = edge.fromNode;
        const target = edge.toNode;
        if (!source || !target) continue;
        edge.path.setAttribute("x1", source.x);
        edge.path.setAttribute("y1", source.y);
        edge.path.setAttribute("x2", target.x);
        edge.path.setAttribute("y2", target.y);
        edge.labelNode.setAttribute("x", (source.x + target.x) / 2);
        edge.labelNode.setAttribute("y", (source.y + target.y) / 2);
      }
      for (const node of nodes) {
        node.element.setAttribute("transform", \`translate(\${node.x},\${node.y})\`);
      }
    }
    requestAnimationFrame(function settle() {
      stepGraph();
      renderGraph();
      requestAnimationFrame(settle);
    });

    const filter = document.querySelector("#filter");
    const cards = Array.from(document.querySelectorAll(".table-card"));
    filter.addEventListener("input", () => {
      const query = filter.value.trim().toLowerCase();
      for (const card of cards) {
        card.hidden = query.length > 0 && !card.textContent.toLowerCase().includes(query);
      }
    });
  </script>
</body>
</html>
`;
}

function buildGraphData(reports: TableReport[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  return {
    nodes: reports.map((report) => ({
      id: report.name,
      label: report.name,
      group: inferGroup(report.name),
      columns: report.columns.length,
    })),
    edges: reports.flatMap((report) =>
      report.foreignKeys.map((foreignKey) => ({
        from: report.name,
        to: foreignKey.targetTable,
        label: foreignKey.columns.join(", "),
        onDelete: foreignKey.onDelete,
      })),
    ),
  };
}

function inferGroup(tableName: string): string {
  if (tableName.includes("vocabulary") || tableName.includes("word_review")) return "vocabulary";
  if (tableName.includes("translation_request") || tableName.includes("language_detection")) return "translation";
  if (
    tableName.includes("admin") ||
    tableName.includes("setting") ||
    tableName.includes("plan") ||
    tableName.includes("preset")
  ) {
    return "admin";
  }
  if (tableName.includes("latencies") || tableName.includes("timings") || tableName.includes("history"))
    return "observability";
  if (tableName.includes("video")) return "video";
  if (tableName.includes("cache") || tableName.includes("context")) return "cache";
  if (tableName.includes("session") || tableName.includes("release")) return "system";
  return "core";
}

function renderLegend(nodes: GraphNode[]): string {
  const groups = [...new Set(nodes.map((node) => node.group))].sort();
  const colors: Record<string, string> = {
    admin: "#ece5f7",
    cache: "#eaf3df",
    core: "#dff3ef",
    observability: "#e6f1f7",
    system: "#eef3f6",
    translation: "#fff2d8",
    video: "#fde8df",
    vocabulary: "#e8eefc",
  };

  return `<div class="legend">${groups
    .map(
      (group) =>
        `<span class="legend-item"><span class="legend-swatch" style="background:${colors[group] ?? colors.system}"></span>${escapeHtml(group)}</span>`,
    )
    .join("")}</div>`;
}

function renderTableCard(report: TableReport): string {
  const columnRows = report.columns
    .map(
      (column) => `<tr>
        <td><code>${escapeHtml(column.name)}</code><div class="small">${escapeHtml(column.propertyName)}</div></td>
        <td>${escapeHtml(column.type)}<div class="small">${escapeHtml(column.dataType)}</div></td>
        <td>${column.nullable ? "yes" : "no"}</td>
        <td>${column.primaryKey ? "PK" : ""} ${column.unique ? "unique" : ""} ${column.defaulted ? "default" : ""}</td>
      </tr>`,
    )
    .join("\n");
  const relationBadges = [
    ...report.foreignKeys.map(
      (foreignKey) =>
        `<span class="badge">${escapeHtml(foreignKey.columns.join(", "))} -> ${escapeHtml(foreignKey.targetTable)}</span>`,
    ),
    ...report.inbound.map(
      (foreignKey) => `<span class="badge">${escapeHtml(foreignKey.targetTable)} -> ${escapeHtml(report.name)}</span>`,
    ),
  ].join("");
  const indexRows = report.indexes
    .map(
      (index) => `<tr>
        <td><code>${escapeHtml(index.name)}</code></td>
        <td>${escapeHtml(index.columns.join(", "))}</td>
        <td>${index.primary ? "primary" : index.unique ? "unique" : "index"}</td>
      </tr>`,
    )
    .join("\n");
  const usageFiles = report.usage.files
    .slice(0, 10)
    .map((file) => `<li><code>${escapeHtml(file)}</code></li>`)
    .join("");
  const usageOverflow =
    report.usage.files.length > 10 ? `<li class="small">and ${report.usage.files.length - 10} more files</li>` : "";
  const notes = report.notes.map((note) => `<div class="note">${escapeHtml(note)}</div>`).join("");

  return `<article class="table-card" id="${escapeAttribute(report.name)}">
    <div class="table-head">
      <div>
        <h3>${escapeHtml(report.name)}</h3>
        <div class="small">export <code>${escapeHtml(report.exportName)}</code></div>
        <p>${escapeHtml(report.description)}</p>
        <div class="badges">${relationBadges || '<span class="badge">no declared relations</span>'}</div>
      </div>
      <div class="small">${report.columns.length} columns<br>${report.foreignKeys.length} outbound FK<br>${report.inbound.length} inbound FK<br>${report.usage.directMentions} direct symbol mentions</div>
    </div>
    <div class="table-body">
      ${notes}
      <div class="grid">
        <div>
          <h4>Columns</h4>
          <table><thead><tr><th>Name</th><th>Type</th><th>Nullable</th><th>Flags</th></tr></thead><tbody>${columnRows}</tbody></table>
        </div>
        <div>
          <h4>Indexes</h4>
          <table><thead><tr><th>Name</th><th>Columns</th><th>Kind</th></tr></thead><tbody>${indexRows}</tbody></table>
          <h4>Usage</h4>
          <ul>${usageFiles}${usageOverflow}</ul>
        </div>
      </div>
    </div>
  </article>`;
}

function toColumnNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((column) => String(toRecord(column).name ?? "unknown"));
}

function toRecord(value: unknown): UnknownRecord {
  if (!isRecord(value)) {
    return {};
  }

  return value;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function getSymbolValue(value: unknown, name: string): unknown {
  if (!isRecord(value)) {
    return undefined;
  }

  const symbol = Object.getOwnPropertySymbols(value).find((candidate) => String(candidate) === name);
  return symbol ? value[symbol] : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll(" ", "-");
}

function escapeScriptJson(value: string): string {
  return value.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
}
