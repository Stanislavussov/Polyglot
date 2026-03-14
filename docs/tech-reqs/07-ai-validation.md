# AI Response Validation (multi-level)

```
AI Response
    │
    ├─ 1. Zod schema (JSON structure)            — free, always
    ├─ 2. Semantic rules                          — free, always
    │       • translation ≠ original
    │       • examples contain the translated word
    │       • no hallucination patterns ("N/A", "I cannot", "—")
    ├─ 3. franc (language detection)              — free, always
    │
    ├─ PASS → save to cache
    │
    ├─ FAIL → retry #1 (strict prompt)
    │            │
    │         FAIL → retry #2
    │                  │
    │               FAIL → 4. AI validation      — paid, only here
    │                          │
    │                       FAIL → save with needsReview=true
    │                              show to user with ⚠️
```
