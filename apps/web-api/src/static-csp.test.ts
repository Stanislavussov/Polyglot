import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inlineScriptHashes } from "./static-csp.js";

const sha = (body: string) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`;

describe("inlineScriptHashes", () => {
  it("hashes inline scripts in nested pages and skips external ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "csp-"));
    mkdirSync(join(dir, "translate"));
    writeFileSync(join(dir, "index.html"), '<script>a()</script><script src="/x.js"></script>');
    writeFileSync(join(dir, "translate", "index.html"), '<script type="module">b()</script><script>a()</script>');

    expect(inlineScriptHashes(dir).sort()).toEqual([sha("a()"), sha("b()")].sort());
  });
});
