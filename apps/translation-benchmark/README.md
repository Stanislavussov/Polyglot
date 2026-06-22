# Translation benchmark

Runs one OpenRouter model through:

- 30 translation-quality scenarios using the production translation, validation, and retry pipeline;
- 72 source-language detection scenarios covering homographs, candidate ordering, close languages, code-switching, brands, transliteration, typos, and acronyms.

No API request is made until the command is run explicitly:

```bash
pnpm translation:benchmark -- --model openai/gpt-4o
```

Run the small smoke group first to verify credentials, database access, model compatibility, report writing, and both benchmark pipelines:

```bash
pnpm translation:benchmark -- --group smoke --model openai/gpt-4o
```

The smoke group runs 5 translation scenarios and 10 source-detection scenarios. The default `all` group runs the complete dataset.

`AI_MODEL` may be used instead of `--model`. The OpenRouter API key and development database configuration are loaded from the existing environment.

By default, the JSON report is written under `translation-benchmark-results/`. A custom path can be supplied:

```bash
pnpm translation:benchmark -- --model openai/gpt-4o --output ./translation-report.json
```

The report contains expected meanings and quality risks, normalized translation results, every raw generation attempt, and language-detection expectation matches. A non-zero exit code means at least one translation failed or one detector result differed from the expected action.
