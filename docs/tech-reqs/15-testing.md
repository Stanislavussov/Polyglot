# Testing

## Stack

| Tool                    | Role                                                       |
| ----------------------- | ---------------------------------------------------------- |
| **Vitest**              | Test runner — fast, native TypeScript, Jest-compatible API |
| **@vitest/coverage-v8** | Coverage report                                            |

```bash
pnpm add -D vitest @vitest/coverage-v8
```

---

## Strategy by Module

| Module          | Test type   | What we test                                                  |
| --------------- | ----------- | ------------------------------------------------------------- |
| `validation`    | Unit        | Semantic rules, franc language detector                       |
| `translation`   | Unit        | Prompt building, response parsing                             |
| `i18n`          | Unit        | Translation keys, fallback                                    |
| `db`            | Integration | Repositories against a real test DB                           |
| `topics`        | Integration | Cache logic: hit / miss / partial                             |
| `notifications` | Integration | Cron trigger + injected sendFn                                |
| `bot`           | E2E         | Onboarding, translation scenarios via grammY test utils |

---

## Test Structure

Tests live alongside the module — not in a separate `__tests__` folder:

```
modules/
  translation/
    translation.service.ts
    translation.service.test.ts
    prompt.builder.test.ts
  validation/
    semantic.validator.test.ts
    language.validator.test.ts
  ...
```

---

## Test Examples

```tsx
// modules/validation/semantic.validator.test.ts
import { describe, it, expect } from "vitest";
import { validateSemantic } from "./semantic.validator";

describe("semantic validator", () => {
  it("rejects a translation equal to the original", () => {
    const result = validateSemantic({
      original: "apple",
      translation: "apple",
      lang: "en",
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("equals original");
  });

  it("rejects hallucination patterns", () => {
    const result = validateSemantic({
      original: "яблоко",
      translation: "N/A",
      lang: "en",
    });
    expect(result.valid).toBe(false);
  });

  it("passes a valid translation", () => {
    const result = validateSemantic({
      original: "яблоко",
      translation: "apple",
      lang: "en",
    });
    expect(result.valid).toBe(true);
  });
});
```

```tsx
// modules/topics/topic.service.test.ts — integration
import { describe, it, expect, vi } from "vitest";
import { getTopicWords } from "./topic.service";

describe("topic cache", () => {
  it("returns from cache if translation already exists", async () => {
    const translateMock = vi.fn();
    // Pre-populate test DB with cache
    const result = await getTopicWords("food", "ru", ["en"], translateMock);
    expect(translateMock).not.toHaveBeenCalled(); // AI was not called
    expect(result[0].translations.en).toBeDefined();
  });

  it("calls AI only for missing languages", async () => {
    const translateMock = vi.fn().mockResolvedValue({ text: "apple", ... });
    // Cache has "en", missing "cs"
    await getTopicWords("food", "ru", ["en", "cs"], translateMock);
    expect(translateMock).toHaveBeenCalledTimes(1); // only for "cs"
  });
});
```

---

## Configuration

```tsx
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Minimum coverage thresholds
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
      },
      // Leaf modules should be fully covered
      perFile: true,
    },
  },
  resolve: {
    alias: { "@": "/src" },
  },
});
```

---

## Scripts

```json
// package.json
"scripts": {
  "test": "vitest run",               // single run
  "test:watch": "vitest",             // watch mode during development
  "test:coverage": "vitest run --coverage",
  "test:unit": "vitest run --testPathPattern=unit",
  "test:integration": "vitest run --testPathPattern=integration"
}
```
