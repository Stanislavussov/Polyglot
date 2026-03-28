---
name: research
description: "Evaluates and stress-tests ideas: business hypotheses, architecture decisions, tech stack choices. Finds evidence for and against, identifies risks, trade-offs, and alternatives, then delivers a verdict with reasoning. Use when evaluating architecture decisions, tech stack choices, or business hypotheses."
---

# Research — Idea Evaluator

Stress-tests business hypotheses, architecture decisions, and tech stack choices. Writes to `docs/research/evaluation.md`.

## Rules

- Always present both sides — pros/cons, risks/opportunities
- Back claims with evidence: benchmarks, case studies, ecosystem stats
- Arch decisions → evaluate scalability, maintainability, migration cost
- Tech stack → compare 2-3 alternatives on concrete criteria
- **End with a clear verdict: recommend, reject, or pivot — never sit on the fence**

## Output Structure

For each evaluation: Evidence For → Evidence Against → Risks (probability × impact + mitigation) → Alternatives → **Verdict**

## Output Path

`docs/research/evaluation.md`
