// Every image must carry every workspace package it needs. Two mistakes have
// shipped a broken build before (the payments/auth adapters, 2026-11-15):
//
// 1. A stage that runs `pnpm install --frozen-lockfile` with a package's
//    package.json but not those of the workspace packages it depends on — their
//    own dependencies are never installed and the build fails (TS2307 'jose').
// 2. A runtime stage that copies an app's dist but not the dist of a workspace
//    package the app imports — the container crashes on the first import.
//
// Run: pnpm lint:docker
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const WORKSPACE_GLOBS = ["packages", "packages/adapters", "apps"];

/** Workspace packages: dir, name, workspace deps, and whether a build makes a dist. */
export function readWorkspace(root = ROOT) {
  const packages = [];
  for (const parent of WORKSPACE_GLOBS) {
    let entries;
    try {
      entries = readdirSync(join(root, parent), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = `${parent}/${entry.name}`;
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8"));
      } catch {
        continue;
      }
      const deps = Object.entries(manifest.dependencies ?? {})
        .filter(([, version]) => String(version).startsWith("workspace:"))
        .map(([name]) => name);
      const buildsDist = /\btsc\b/.test(manifest.scripts?.build ?? "");
      packages.push({ dir, name: manifest.name, deps, buildsDist });
    }
  }
  return packages;
}

/** A Dockerfile split into its `FROM … AS name` stages. */
export function parseStages(dockerfile) {
  const stages = [];
  for (const line of dockerfile.split("\n")) {
    const from = /^FROM\s+\S+(?:\s+AS\s+(\S+))?/i.exec(line.trim());
    if (from) stages.push({ name: from[1] ?? `stage${stages.length}`, lines: [] });
    else stages.at(-1)?.lines.push(line.trim());
  }
  return stages;
}

const norm = (path) => path.replace(/^\.\//, "").replace(/\/$/, "");

function copiedManifests(lines) {
  const copied = new Set();
  for (const line of lines) {
    const match = /^COPY\s+(?!--from)(\S+)\/package\.json\s/.exec(line);
    if (match) copied.add(norm(match[1]));
  }
  return copied;
}

function copiedDists(lines) {
  const copied = new Set();
  for (const line of lines) {
    const match = /^COPY\s+--from=\S+\s+\/app\/(\S+)\/dist\s+(\S+)/.exec(line);
    if (match) copied.add(norm(match[1]));
  }
  return copied;
}

function transitiveDeps(pkg, byName) {
  const seen = new Set();
  const walk = (name) => {
    for (const dep of byName.get(name)?.deps ?? []) {
      if (!seen.has(dep)) {
        seen.add(dep);
        walk(dep);
      }
    }
  };
  walk(pkg.name);
  return [...seen].map((name) => byName.get(name)).filter(Boolean);
}

/** Problems in one Dockerfile, as human-readable lines. */
export function checkDockerfile(file, dockerfile, packages) {
  const problems = [];
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const byDir = new Map(packages.map((pkg) => [pkg.dir, pkg]));

  for (const stage of parseStages(dockerfile)) {
    // An installing stage installs only the packages whose manifest it copied, so
    // each of those needs the manifests of everything it depends on — or the
    // dependency's own third-party deps (jose, …) are never installed.
    const installs = stage.lines.some((line) => /pnpm install\b.*--frozen-lockfile/.test(line));
    if (installs) {
      const copied = copiedManifests(stage.lines);
      for (const dir of copied) {
        const pkg = byDir.get(dir);
        if (!pkg) continue;
        for (const dep of transitiveDeps(pkg, byName)) {
          if (!copied.has(dep.dir)) {
            problems.push(
              `${file} stage "${stage.name}": ${pkg.name} needs ${dep.name} — add \`COPY ${dep.dir}/package.json ${dep.dir}/\` before \`pnpm install --frozen-lockfile\``,
            );
          }
        }
      }
    }

    // A runtime stage: it copies an app's built dist into its own apps/ tree.
    const dists = copiedDists(stage.lines);
    for (const dir of dists) {
      const app = byDir.get(dir);
      if (!app || !dir.startsWith("apps/")) continue;
      for (const dep of transitiveDeps(app, byName)) {
        if (dep.buildsDist && !dists.has(dep.dir)) {
          problems.push(
            `${file} stage "${stage.name}": ${app.name} imports ${dep.name} — add \`COPY --from=build /app/${dep.dir}/dist ${dep.dir}/dist\``,
          );
        }
      }
    }
  }
  return problems;
}

function main() {
  const packages = readWorkspace();
  const deployDir = join(ROOT, "deploy");
  const files = readdirSync(deployDir).filter((name) => /^Dockerfile(\..+)?$/.test(name));
  const problems = files.flatMap((name) =>
    checkDockerfile(`deploy/${name}`, readFileSync(join(deployDir, name), "utf8"), packages),
  );
  if (problems.length > 0) {
    for (const problem of problems) console.error(`::error::${problem}`);
    process.exit(1);
  }
  console.log(`Docker layers OK (${files.length} Dockerfiles, ${packages.length} workspace packages).`);
}

if (process.argv[1]?.endsWith("check-docker-layers.mjs")) main();
