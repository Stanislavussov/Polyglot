# Task: Make native-source connotations target-side only

Status: implemented.

## Problem

When a Russian-native user translates a Russian word such as "ябеда" into learning languages, the connotation marker/description appears repeatedly and describes the Russian source word. That is not useful in this case: the user already knows the source word in their native language.

Connotation should describe the translated target word in each learning language: its nuance, usage context, register, and closest cultural/semantic connotation in that target language.

## Example

User native language: Russian.
Learning languages: multiple target languages.
Input word: "ябеда".

Current behavior:

- The connotation marker appears repeatedly.
- The connotation text describes "ябеда" in Russian / the user's native language.
- The target-language connotation is either missing or not clearly tied to the translated word.

Expected behavior:

- For native-language source input, do not generate connotation notes for the source/native word itself.
- Generate connotation only for each translated target word.
- Each connotation should be specific to that target language's translation, not copied from or framed around the Russian source word.

## Proposed Rule

If the source language is the user's native language, treat connotation as target-side metadata only.

For each target translation, connotation should answer: what does the translated word imply in that target language, and in what context/register would a native speaker use it?

## Acceptance Criteria

- [x] Translating Russian "ябеда" for a Russian-native user does not show a connotation block describing the Russian source word.
- [x] Each learning-language translation may show its own connotation if it is relevant.
- [x] Connotation text is target-language specific and does not repeat the same native-source explanation across all target cards.
- [x] The connotation marker does not appear multiple times for the native source word.
- [x] Existing behavior for learning-language source input is not regressed.

## Implementation Notes

- `connotationWarning` remains per target-language translation block.
- Prompt rules now define it as target-side metadata: nuance, usage context, register, or closest cultural/semantic connotation of the translated target word/expression.
- When `sourceLang === nativeLang`, the prompt explicitly forbids using `connotationWarning` to explain the native source word.
- Retry prompts repeat the same target-side/native-source guardrails.

## Files Modified

- `packages/core/src/modules/translation/prompt.builder.ts`
- `packages/core/src/modules/translation/types.ts`
- `packages/core/src/modules/translation/__tests__/prompt.builder.test.ts`
- `packages/core/src/modules/translation/__tests__/output-config.test.ts`
- `.pi/skills/translation/SKILL.md`

## Notes

This is related to the existing response-shape work in `docs/tasks/learning-source-response-shape.md`, but covers the opposite direction: native-language source input translated into learning languages.
