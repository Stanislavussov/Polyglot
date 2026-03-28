import { describe, expect, it } from "vitest";
import { getIso1ToIso3Map, getIso3ToIso1Map, normalizeToIso1, resolveToIso3 } from "../language-registry.js";

// Registry is initialized by test-setup.ts (vitest setupFiles)

describe("getIso1ToIso3Map", () => {
  it("maps common ISO 639-1 codes to ISO 639-3", () => {
    const map = getIso1ToIso3Map();
    expect(map.en).toBe("eng");
    expect(map.ru).toBe("rus");
    expect(map.cs).toBe("ces");
    expect(map.de).toBe("deu");
  });
});

describe("getIso3ToIso1Map", () => {
  it("maps ISO 639-3 codes back to ISO 639-1", () => {
    const map = getIso3ToIso1Map();
    expect(map.eng).toBe("en");
    expect(map.rus).toBe("ru");
    expect(map.ces).toBe("cs");
    expect(map.deu).toBe("de");
  });

  it("is the exact inverse of getIso1ToIso3Map", () => {
    const iso1to3 = getIso1ToIso3Map();
    const iso3to1 = getIso3ToIso1Map();
    for (const [iso1, iso3] of Object.entries(iso1to3)) {
      expect(iso3to1[iso3]).toBe(iso1);
    }
  });
});

describe("resolveToIso3", () => {
  it("resolves ISO 639-1 codes", () => {
    expect(resolveToIso3("en")).toBe("eng");
    expect(resolveToIso3("cs")).toBe("ces");
    expect(resolveToIso3("ru")).toBe("rus");
  });

  it("passes through ISO 639-3 codes", () => {
    expect(resolveToIso3("eng")).toBe("eng");
    expect(resolveToIso3("ces")).toBe("ces");
  });

  it("resolves common English names (case-insensitive)", () => {
    expect(resolveToIso3("english")).toBe("eng");
    expect(resolveToIso3("Russian")).toBe("rus");
    expect(resolveToIso3("Czech")).toBe("ces");
    expect(resolveToIso3("GERMAN")).toBe("deu");
  });

  it("returns undefined for unknown identifiers", () => {
    expect(resolveToIso3("xxx")).toBeUndefined();
    expect(resolveToIso3("klingon")).toBeUndefined();
  });
});

describe("normalizeToIso1", () => {
  it("passes through ISO 639-1 codes", () => {
    expect(normalizeToIso1("en")).toBe("en");
    expect(normalizeToIso1("ru")).toBe("ru");
    expect(normalizeToIso1("cs")).toBe("cs");
  });

  it("converts ISO 639-3 codes to ISO 639-1", () => {
    expect(normalizeToIso1("eng")).toBe("en");
    expect(normalizeToIso1("rus")).toBe("ru");
    expect(normalizeToIso1("ces")).toBe("cs");
    expect(normalizeToIso1("deu")).toBe("de");
    expect(normalizeToIso1("fra")).toBe("fr");
    expect(normalizeToIso1("spa")).toBe("es");
  });

  it("converts common English names to ISO 639-1", () => {
    expect(normalizeToIso1("english")).toBe("en");
    expect(normalizeToIso1("Russian")).toBe("ru");
    expect(normalizeToIso1("Czech")).toBe("cs");
    expect(normalizeToIso1("GERMAN")).toBe("de");
  });

  it("returns undefined for unknown identifiers", () => {
    expect(normalizeToIso1("xxx")).toBeUndefined();
    expect(normalizeToIso1("klingon")).toBeUndefined();
  });
});
