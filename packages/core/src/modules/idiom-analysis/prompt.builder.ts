import type { IdiomAnalysisInput } from './types.js';

/**
 * Builds a prompt for AI to analyze translation quality for idiomatic correctness
 */
export function buildIdiomAnalysisPrompt(input: IdiomAnalysisInput): string {
  // Escape quotes in input to prevent prompt injection
  const sourcePhrase = input.sourcePhrase.replace(/"/g, '\\"');
  const translatedPhrase = input.translatedPhrase.replace(/"/g, '\\"');
  const sourceLang = input.sourceLang.replace(/"/g, '\\"');
  const targetLang = input.targetLang.replace(/"/g, '\\"');

  return `You are a linguistic expert analyzing translation quality between languages.

## Task
Analyze whether a translated phrase preserves idiomatic meaning or is an unnatural literal translation.

## Input
- Source phrase: "${sourcePhrase}"
- Source language: ${sourceLang}
- Translated phrase: "${translatedPhrase}"
- Target language: ${targetLang}

## Analysis Steps

1. **Identify Source Expression Type**
   - Determine if the source phrase is idiomatic (idiom, proverb, slang, figurative speech, or fixed expression)
   - If idiomatic, identify both the literal and intended/figurative meaning

2. **Evaluate Translation Quality**
   - Check if the translated phrase is:
     - A natural, commonly used expression in the target language (CORRECT_IDIOMATIC_TRANSLATION)
     - A word-for-word literal translation that sounds unnatural or artificial (LITERAL_BUT_UNNATURAL)
     - A translation that fails to convey the same meaning (INCORRECT_MEANING)

3. **Compare Semantic Meaning**
   - Verify that both phrases convey the same emotional tone
   - Check that the intensity/emphasis is preserved

4. **Provide Alternative (if needed)**
   - If the translation is not natural, suggest a commonly used equivalent expression in the target language

## Response Format
Return a JSON object with all analysis fields. Be thorough but concise in explanations.

## Important Rules
- Focus on how native speakers actually use expressions
- Consider cultural context and regional variations
- A literal translation can be CORRECT if the expression translates directly
- Set confidence based on how certain you are about the classification
- Always provide suggestedAlternative when classification is not CORRECT_IDIOMATIC_TRANSLATION
- **For phraseologisms without a direct equivalent in the target language**: suggest a contextually appropriate translation that conveys the same meaning and emotional impact, rather than a literal translation. If no equivalent idiom exists, provide a natural-sounding phrase that native speakers would actually use in the same situation.`;
}
