import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateSchema } from "../validators/schema.validator.js";

describe("validateSchema", () => {
  const testSchema = z.object({
    name: z.string(),
    age: z.number().min(0),
    email: z.string().email().optional(),
  });

  it("returns valid for conforming data", () => {
    const result = validateSchema({ name: "Alice", age: 30 }, testSchema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns valid with optional fields present", () => {
    const result = validateSchema({ name: "Alice", age: 30, email: "alice@example.com" }, testSchema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns errors for missing required field", () => {
    const result = validateSchema({ age: 30 }, testSchema);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].rule).toBe("schema");
    expect(result.errors[0].field).toBe("name");
  });

  it("returns errors for wrong type", () => {
    const result = validateSchema({ name: "Alice", age: "thirty" }, testSchema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "age")).toBe(true);
  });

  it("returns errors for invalid email format", () => {
    const result = validateSchema({ name: "Alice", age: 30, email: "not-an-email" }, testSchema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "email")).toBe(true);
  });

  it("returns errors for null input", () => {
    const result = validateSchema(null, testSchema);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns errors for undefined input", () => {
    const result = validateSchema(undefined, testSchema);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("includes path for nested schema errors", () => {
    const nestedSchema = z.object({
      translations: z.object({
        en: z.object({
          text: z.string(),
        }),
      }),
    });

    const result = validateSchema({ translations: { en: { text: 42 } } }, nestedSchema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field?.includes("translations"))).toBe(true);
  });
});
