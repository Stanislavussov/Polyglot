import { describe, expect, it } from "vitest";
import { ISO1_TO_ISO3 } from "../detect-language.js";

describe("ISO1_TO_ISO3 local map", () => {
  it("contains all supported bot languages", () => {
    expect(ISO1_TO_ISO3.en).toBe("eng");
    expect(ISO1_TO_ISO3.ru).toBe("rus");
    expect(ISO1_TO_ISO3.cs).toBe("ces");
    expect(ISO1_TO_ISO3.de).toBe("deu");
    expect(ISO1_TO_ISO3.fr).toBe("fra");
    expect(ISO1_TO_ISO3.es).toBe("spa");
    expect(ISO1_TO_ISO3.it).toBe("ita");
    expect(ISO1_TO_ISO3.pt).toBe("por");
    expect(ISO1_TO_ISO3.uk).toBe("ukr");
    expect(ISO1_TO_ISO3.pl).toBe("pol");
  });

  it("contains detection-only languages", () => {
    expect(ISO1_TO_ISO3.ja).toBe("jpn");
    expect(ISO1_TO_ISO3.zh).toBe("cmn");
    expect(ISO1_TO_ISO3.ko).toBe("kor");
    expect(ISO1_TO_ISO3.ar).toBe("arb");
    expect(ISO1_TO_ISO3.hi).toBe("hin");
    expect(ISO1_TO_ISO3.tr).toBe("tur");
    expect(ISO1_TO_ISO3.el).toBe("ell");
  });

  it("contains all European languages for franc detection", () => {
    expect(ISO1_TO_ISO3.nl).toBe("nld");
    expect(ISO1_TO_ISO3.sv).toBe("swe");
    expect(ISO1_TO_ISO3.da).toBe("dan");
    expect(ISO1_TO_ISO3.no).toBe("nob");
    expect(ISO1_TO_ISO3.fi).toBe("fin");
    expect(ISO1_TO_ISO3.hu).toBe("hun");
    expect(ISO1_TO_ISO3.ro).toBe("ron");
    expect(ISO1_TO_ISO3.bg).toBe("bul");
    expect(ISO1_TO_ISO3.hr).toBe("hrv");
    expect(ISO1_TO_ISO3.sk).toBe("slk");
    expect(ISO1_TO_ISO3.sl).toBe("slv");
    expect(ISO1_TO_ISO3.sr).toBe("srp");
    expect(ISO1_TO_ISO3.lt).toBe("lit");
    expect(ISO1_TO_ISO3.lv).toBe("lav");
    expect(ISO1_TO_ISO3.et).toBe("est");
  });

  it("is a frozen/readonly object", () => {
    expect(Object.isFrozen(ISO1_TO_ISO3)).toBe(true);
  });
});
