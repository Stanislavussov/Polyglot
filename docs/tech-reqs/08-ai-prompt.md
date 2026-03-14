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
