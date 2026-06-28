import { describe, expect, it } from "vitest";
import { collectTestsFromSource, renderTestCatalogHtml } from "./test-catalog.mjs";

describe("test catalog generator", () => {
  it("extracts business descriptions from comments next to test scenarios", () => {
    const scenarios = collectTestsFromSource({
      rootDir: "/repo",
      filePath: "/repo/apps/bot/src/video.test.ts",
      sourceText: `
        describe("Video Vocabulary", () => {
          /**
           * @business User can paste a YouTube URL and receive ranked phrases.
           */
          it("returns ranked phrases from transcript", () => {});
        });
      `,
    });

    expect(scenarios).toEqual([
      expect.objectContaining({
        kind: "business",
        packageName: "bot",
        description: "User can paste a YouTube URL and receive ranked phrases.",
        suitePath: ["Video Vocabulary"],
        title: "returns ranked phrases from transcript",
      }),
    ]);
  });

  it("classifies tests without a business comment as technical scenarios", () => {
    const scenarios = collectTestsFromSource({
      rootDir: "/repo",
      filePath: "/repo/packages/adapters/db/src/schema.test.ts",
      sourceText: `
        describe("schema report", () => {
          it("escapes table descriptions", () => {});
        });
      `,
    });

    expect(scenarios).toEqual([
      expect.objectContaining({
        kind: "technical",
        packageName: "adapters/db",
        description: "schema report > escapes table descriptions",
      }),
    ]);
  });

  it("escapes scenario text in the standalone HTML artifact", () => {
    const html = renderTestCatalogHtml({
      catalog: {
        generatedAt: "2026-06-28T12:00:00.000Z",
        summary: {
          total: 1,
          business: 1,
          technical: 0,
          workspaces: ["apps"],
          packages: ["admin"],
        },
        scenarios: [
          {
            id: "dangerous",
            kind: "business",
            filePath: "apps/admin/src/lib/api.test.ts",
            sourceLine: 12,
            workspace: "apps",
            packageName: "admin",
            suitePath: ["<script>alert(1)</script>"],
            title: "renders <dangerous> title",
            description: "Protects & explains \"business\" behavior",
          },
        ],
      },
    });

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("renders &lt;dangerous&gt; title");
    expect(html).toContain("Protects &amp; explains &quot;business&quot; behavior");
  });
});
