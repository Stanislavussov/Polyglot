import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = fileURLToPath(new URL("..", import.meta.url));
const TOKENS_PATH = join(SRC_DIR, "styles/tokens.css");
const SCANNED_EXTENSIONS = /\.(vue|astro|ts|css)$/;
// 3, 4, 6 and 8 digit forms; the boundary keeps words such as "#content" out.
const HEX_COLOR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/;

type TokenMap = Record<string, string>;

function declarations(block: string): TokenMap {
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]),
  );
}

// Selector -> declarations. The dark media query nests its rule one level deeper, so it is cut out first.
function parseTokens(css: string): { light: TokenMap; dark: TokenMap; system: TokenMap } {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const media = withoutComments.match(/@media \(prefers-color-scheme: dark\)\s*\{([\s\S]*)\}\s*$/);
  const outer = media ? withoutComments.slice(0, media.index) : withoutComments;
  const body = (selector: string, source: string): string => {
    const start = source.indexOf(selector);
    if (start === -1) throw new Error(`selector not found: ${selector}`);
    return source.slice(source.indexOf("{", start) + 1, source.indexOf("}", start));
  };
  return {
    light: declarations(body(":root {", outer)),
    dark: declarations(body(':root[data-theme="dark"]', outer)),
    system: declarations(body(':root:not([data-theme="light"])', media?.[1] ?? "")),
  };
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "generated" ? [] : sourceFiles(path);
    return SCANNED_EXTENSIONS.test(name) ? [path] : [];
  });
}

describe("theme tokens", () => {
  const tokens = parseTokens(readFileSync(TOKENS_PATH, "utf8"));

  it("keeps the token names and values stable", () => {
    expect(tokens).toMatchSnapshot();
  });

  it("defines every colour token in light and dark", () => {
    const colours = (map: TokenMap) => Object.keys(map).filter((name) => name.startsWith("--color-"));
    expect(colours(tokens.dark)).toEqual(colours(tokens.light));
  });

  it("gives the system dark preference the same values as data-theme=dark", () => {
    const colours = (map: TokenMap) =>
      Object.fromEntries(Object.entries(map).filter(([name]) => name.startsWith("--color-")));
    expect(colours(tokens.system)).toEqual(colours(tokens.dark));
  });

  it("keeps hex colour literals out of every file except tokens.css", () => {
    const offenders = sourceFiles(SRC_DIR)
      .filter((path) => path !== TOKENS_PATH)
      .filter((path) => HEX_COLOR.test(readFileSync(path, "utf8")))
      .map((path) => relative(SRC_DIR, path));
    expect(offenders).toEqual([]);
  });
});
