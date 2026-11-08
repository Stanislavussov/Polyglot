import { describe, expect, it } from "vitest";
import { mentorHtml } from "./mentor-html";

describe("mentorHtml", () => {
  it("keeps the bold and italic tags the mentor is asked to use", () => {
    expect(mentorHtml("<b>Gift</b> means <i>poison</i>")).toBe("<b>Gift</b> means <i>poison</i>");
  });

  it("escapes every other tag and attribute", () => {
    expect(mentorHtml('<img src=x onerror="alert(1)"><b onclick="x">hi</b>')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&lt;b onclick=&quot;x&quot;&gt;hi</b>",
    );
  });

  it("escapes ampersands so entities cannot be smuggled in", () => {
    expect(mentorHtml("a &lt;script&gt; & b")).toBe("a &amp;lt;script&amp;gt; &amp; b");
  });
});
