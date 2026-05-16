# AI Prompt Structure (translation)

One request returns everything at once:

```
Translate "{word}" from {sourceLang} to {targetLangs[]}.
Return ONLY valid JSON, no markdown, no explanation:
{
  "emoji": "<one relevant emoji>",
  "register": "slang | colloquial | neutral | literary | professional",
  "translations": {
    "{lang}": {
      "text": "<translation>",
      "register": "slang | colloquial | neutral | literary | professional",
      "expressionType": "literal | idiomatic_equivalent",
      "equivalentNote": "<brief note explaining idiomatic equivalent choice — omit for literal>",
      "synonyms": [
        { "text": "<synonym>", "register": "slang | colloquial | neutral | literary | professional" }
      ],
      "examples": [
        "<formal example sentence>",
        "<casual example sentence>",
        "<professional/specific context>"
      ]
    }
  }
}
```

## Idiomatic & Proverb Rule

When the input is a proverb, idiom, fixed expression, or culturally-bound phrase
that has no natural direct equivalent in a target language, the AI should provide
the **closest functional equivalent** in that language (a proverb, idiom, slang term,
or common speech expression that conveys the same meaning).

- Set `expressionType` to `"idiomatic_equivalent"` and provide a brief `equivalentNote`
  explaining the choice.
- If a direct translation exists and is natural, set `expressionType` to `"literal"`
  (or omit it — defaults to `"literal"`).
- **Never** return a meaningless word-for-word rendering of an idiomatic expression
  when a functional equivalent exists.

### Fields

| Field             | Type                                   | Required | Description                                             |
| ----------------- | -------------------------------------- | -------- | ------------------------------------------------------- |
| `expressionType`  | `"literal" \| "idiomatic_equivalent"` | Optional | Defaults to `"literal"`; signals idiomatic equivalents  |
| `equivalentNote`  | `string`                               | Optional | Brief note explaining why an equivalent was chosen      |
