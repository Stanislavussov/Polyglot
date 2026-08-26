import { describe, expect, it } from "vitest";
import { buildMentorSystemPrompt, MAX_MENTOR_HISTORY } from "./prompt.builder.js";

describe("buildMentorSystemPrompt", () => {
  const opts = {
    nativeLang: "en",
    learningLangs: ["cs", "ru"],
    interfaceLang: "en",
  };

  it("includes the native language in the prompt", () => {
    const prompt = buildMentorSystemPrompt(opts);
    expect(prompt).toContain("en");
  });

  it("includes all learning languages", () => {
    const prompt = buildMentorSystemPrompt(opts);
    expect(prompt).toContain("cs");
    expect(prompt).toContain("ru");
  });

  it("annotates each learning language with its CEFR level", () => {
    const prompt = buildMentorSystemPrompt({ ...opts, levels: { cs: "A2", ru: "C1" } });
    expect(prompt).toContain("cs (A2)");
    expect(prompt).toContain("ru (C1)");
  });

  it("leaves a language without a stored level unannotated", () => {
    const prompt = buildMentorSystemPrompt({ ...opts, levels: { cs: "A2" } });
    expect(prompt).toContain("cs (A2)");
    expect(prompt).not.toMatch(/ru \(/);
  });

  it("tells the AI to calibrate the answer and examples to the level", () => {
    const prompt = buildMentorSystemPrompt({ ...opts, levels: { cs: "A2" } });
    expect(prompt).toMatch(/calibrate/i);
    expect(prompt).toContain("A1-A2");
    expect(prompt).toContain("C1-C2");
    expect(prompt).toMatch(/assume B1/i);
  });

  it("instructs the AI to answer language questions directly", () => {
    const prompt = buildMentorSystemPrompt(opts);
    expect(prompt).toMatch(/answer.*directly|direct(ly)? answer/i);
  });

  it("no longer carries the Socratic word-coach behavior", () => {
    const prompt = buildMentorSystemPrompt(opts);
    expect(prompt).not.toMatch(/do not translate immediately/i);
    expect(prompt).not.toMatch(/ask what they think it means/i);
    expect(prompt).not.toMatch(/2-4 sentences/i);
  });

  it("restricts the assistant to language topics with a one-sentence refusal for off-topic", () => {
    const prompt = buildMentorSystemPrompt(opts);
    expect(prompt).toMatch(/only|strictly/i);
    expect(prompt).toMatch(/language/i);
    expect(prompt).toMatch(/one short.*sentence|single.*sentence/i);
  });

  it("asks for a short answer followed by examples", () => {
    const prompt = buildMentorSystemPrompt(opts);
    expect(prompt).toMatch(/example/i);
  });

  it("demands Telegram HTML emphasis and forbids Markdown asterisks", () => {
    const prompt = buildMentorSystemPrompt(opts);
    expect(prompt).toContain("<b>");
    expect(prompt).toContain("<i>");
    expect(prompt).toMatch(/never use markdown/i);
    expect(prompt).toMatch(/asterisk/i);
  });

  it("asks for a lively-but-bounded amount of emoji", () => {
    const prompt = buildMentorSystemPrompt(opts);
    expect(prompt).toMatch(/emoji/i);
    expect(prompt).toContain("3-6");
    expect(prompt).toMatch(/never emoji spam/i);
  });

  it("includes the interface language so the AI responds in the right language", () => {
    const prompt = buildMentorSystemPrompt({ ...opts, interfaceLang: "ru" });
    expect(prompt).toContain("ru");
  });

  it("handles empty learning languages gracefully", () => {
    const prompt = buildMentorSystemPrompt({ ...opts, learningLangs: [] });
    expect(prompt).toBeTypeOf("string");
    expect(prompt.length).toBeGreaterThan(50);
  });

  it("includes a prompt-injection guard treating user input as untrusted (S6)", () => {
    const prompt = buildMentorSystemPrompt(opts);
    expect(prompt).toMatch(/untrusted/i);
    expect(prompt).toMatch(/never follow.*instructions|ignore.*instructions/i);
  });

  it("stays channel-neutral by default (no hardcoded frontend name)", () => {
    const prompt = buildMentorSystemPrompt(opts);
    expect(prompt).not.toMatch(/telegram/i);
  });

  it("uses the provided channelHint in the prompt", () => {
    const prompt = buildMentorSystemPrompt({ ...opts, channelHint: "a web widget" });
    expect(prompt).toContain("a web widget");
  });
});

describe("MAX_MENTOR_HISTORY", () => {
  it("is a positive even number (full user+assistant turns)", () => {
    expect(MAX_MENTOR_HISTORY).toBeGreaterThan(0);
    expect(MAX_MENTOR_HISTORY % 2).toBe(0);
  });
});
