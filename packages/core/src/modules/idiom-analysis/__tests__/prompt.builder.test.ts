import { describe, it, expect } from 'vitest';
import { buildIdiomAnalysisPrompt } from '../prompt.builder.js';
import type { IdiomAnalysisInput } from '../types.js';

describe('buildIdiomAnalysisPrompt', () => {
  const sampleInput: IdiomAnalysisInput = {
    sourcePhrase: 'Break a leg',
    sourceLang: 'English',
    translatedPhrase: 'Zlom si nohu',
    targetLang: 'Czech',
  };

  it('includes source phrase and language', () => {
    const prompt = buildIdiomAnalysisPrompt(sampleInput);
    expect(prompt).toContain('Source phrase: "Break a leg"');
    expect(prompt).toContain('Source language: English');
  });

  it('includes translated phrase and target language', () => {
    const prompt = buildIdiomAnalysisPrompt(sampleInput);
    expect(prompt).toContain('Translated phrase: "Zlom si nohu"');
    expect(prompt).toContain('Target language: Czech');
  });

  it('contains analysis instructions', () => {
    const prompt = buildIdiomAnalysisPrompt(sampleInput);
    expect(prompt).toContain('Identify Source Expression Type');
    expect(prompt).toContain('Evaluate Translation Quality');
    expect(prompt).toContain('Compare Semantic Meaning');
    expect(prompt).toContain('Provide Alternative');
  });

  it('contains all classification values', () => {
    const prompt = buildIdiomAnalysisPrompt(sampleInput);
    expect(prompt).toContain('CORRECT_IDIOMATIC_TRANSLATION');
    expect(prompt).toContain('LITERAL_BUT_UNNATURAL');
    expect(prompt).toContain('INCORRECT_MEANING');
  });

  it('escapes quotes in source phrase', () => {
    const inputWithQuotes: IdiomAnalysisInput = {
      sourcePhrase: 'He said "hello"',
      sourceLang: 'English',
      translatedPhrase: 'Řekl "ahoj"',
      targetLang: 'Czech',
    };
    const prompt = buildIdiomAnalysisPrompt(inputWithQuotes);
    expect(prompt).toContain('He said \\"hello\\"');
    expect(prompt).toContain('Řekl \\"ahoj\\"');
  });

  it('escapes quotes in language names', () => {
    const inputWithQuotes: IdiomAnalysisInput = {
      sourcePhrase: 'Test',
      sourceLang: '"Formal" English',
      translatedPhrase: 'Test',
      targetLang: '"Standard" Czech',
    };
    const prompt = buildIdiomAnalysisPrompt(inputWithQuotes);
    expect(prompt).toContain('\\"Formal\\" English');
    expect(prompt).toContain('\\"Standard\\" Czech');
  });

  it('contains important rules section', () => {
    const prompt = buildIdiomAnalysisPrompt(sampleInput);
    expect(prompt).toContain('Important Rules');
    expect(prompt).toContain('native speakers');
    expect(prompt).toContain('cultural context');
    expect(prompt).toContain('confidence');
  });

  it('contains guidance for phraseologisms without direct equivalents', () => {
    const prompt = buildIdiomAnalysisPrompt(sampleInput);
    expect(prompt).toContain('phraseologisms without a direct equivalent');
    expect(prompt).toContain('contextually appropriate translation');
  });

  it('mentions expression types', () => {
    const prompt = buildIdiomAnalysisPrompt(sampleInput);
    expect(prompt).toContain('idiom');
    expect(prompt).toContain('proverb');
    expect(prompt).toContain('slang');
    expect(prompt).toContain('figurative');
    expect(prompt).toContain('fixed expression');
  });

  it('mentions tone and intensity analysis', () => {
    const prompt = buildIdiomAnalysisPrompt(sampleInput);
    expect(prompt).toContain('emotional tone');
    expect(prompt).toContain('intensity');
    expect(prompt).toContain('emphasis');
  });
});
