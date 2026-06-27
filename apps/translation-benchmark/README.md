# Translation benchmark

Runs OpenRouter models through:

- 31 translation-quality scenarios using the production translation, validation, judge, and targeted-repair pipeline;
- 72 source-language detection scenarios covering homographs, candidate ordering, close languages, code-switching, brands, transliteration, typos, and acronyms.

No API request is made until the command is run explicitly:

```bash
pnpm translation:benchmark -- --model openai/gpt-4o
```

Translation and detection fixtures run three times by default so the report shows pass rates rather than a single favorable sample. Override this with `--runs`:

```bash
pnpm translation:benchmark -- --model openai/gpt-4o --runs 5
```

Run the small smoke group first to verify credentials, database access, model compatibility, report writing, and both benchmark pipelines:

```bash
pnpm translation:benchmark -- --group smoke --model openai/gpt-4o
```

The smoke group runs 5 translation scenarios and 10 source-detection scenarios. The default `all` group runs the complete dataset.

Compare at least one economy, mid-tier, and strong model in one command:

```bash
pnpm translation:benchmark -- \
  --models openai/gpt-4o-mini,openai/gpt-4o,anthropic/claude-sonnet-4-20250514
```

`--models` requires at least three comma-separated IDs in economy, mid-tier, strong order. It writes a comparison table plus individual Markdown and JSON reports for each model.

`AI_MODEL` may be used instead of `--model`. The OpenRouter API key and development database configuration are loaded from the existing environment.

By default, the Markdown report is written under `@docs/translation-benchmarks/`. A custom path can be supplied:

```bash
pnpm translation:benchmark -- --model openai/gpt-4o --output ./translation-report.md
```

Each Markdown report has a JSON sidecar suitable for regression baselines. Compare a later run with a same-model baseline:

```bash
pnpm translation:benchmark -- \
  --model openai/gpt-4o \
  --baseline @docs/translation-benchmarks/approved-gpt-4o.json
```

Reports contain versioned fixtures, semantic rubrics, executable assertions, actual prompts and raw attempts, prompt/schema versions, model settings, pipeline issues, repeat reasons, per-dimension scores, language-pair pass rates, actual adapter token/cost/latency metrics, repair success, and release gates. Baseline comparison uses a two-proportion z-test and fails the language-pair gate at `z <= -1.96`.

The release gates enforce:

- 100% immutable-token and ambiguity preservation;
- at least 95% primary-translation accuracy;
- at least 90% auxiliary-field accuracy;
- no statistically significant language-pair regression;
- one generation call and no judge for the explicit simple-word fixture.

Benchmark data is not persisted to the database. The CLI exits non-zero for execution failures, assertion failures, detection mismatches, or failed release gates.
