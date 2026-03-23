# Polyglot — Bug Tracker

Bugs identified from BRD vs. task/code audit. Each bug documents the discrepancy, affected files, and actionable acceptance criteria.

| #   | Bug | Severity | Source Tasks | Status |
|-----|-----|----------|--------------|--------|
| [BUG-01](./BUG-01-onboarding-exceeds-brd-max-steps.md) | Onboarding implements 4 steps — BRD mandates max 3 | 🔴 Critical | Task 03 | 🔲 Open |
| [BUG-03](./BUG-03-next-translation-button-conflicting-definitions.md) | Tasks 09 & 17 both resolve "Next translation" button with conflicting definitions | 🟠 Major | Task 09, Task 17 | 🔲 Open |
| [BUG-07](./BUG-07-logging-missing-srs-notification-type.md) | Logging stub only supports `'suggested'` — missing `'srs'` notification type | 🟡 Minor | Task 05 | 🔲 Open |
| [BUG-09](./BUG-09-user-learning-languages-no-max-4-enforcement.md) | `userRepository.updateSettings()` has no max-4 language enforcement required by BRD | 🟡 Minor | Task 14 | 🔲 Open |

---

## Removed Bugs

| # | Bug | Reason |
|---|-----|--------|
| BUG-02 | `MINIMAL_OUTPUT` used for topic translations | Task 21 not implemented yet — no code exists. Converted to task amendment note. |
| BUG-04 | Daily limit hard-coded to 20 | Task 11 not implemented yet — `DAILY_TRANSLATE_LIMIT` doesn't exist in config. Converted to task amendment note. |
| BUG-05 | Task 18 references nonexistent schema columns | Already resolved — `languages` table has `flag`, `native_name`, `is_supported`, `iso3_code`, `localized_names`. |
| BUG-06 | `translation_requests` table collision | Task 11 not implemented yet — only Task 02's logging table exists. Converted to task amendment note. |
| BUG-08 | AI fallback chain hardcoded | Task 08 not implemented yet — no `DEFAULT_FALLBACK_CHAIN` or `AI_FALLBACK_MODELS` in code. Converted to task amendment note. |

---

## Severity Legend

| Severity | Meaning |
|----------|---------|
| 🔴 Critical | Directly contradicts a BRD requirement; blocks correct product behaviour |
| 🟠 Major | Significant discrepancy that will cause runtime failures or wrong UX |
| 🟡 Minor | Incomplete contract or missing enforcement; low immediate risk |

## Resolution Priority

1. **BUG-01** — Fix onboarding immediately; it's user-facing and violates a core BRD constraint
2. **BUG-03** — Resolve BRD Open Question #1 before either Task 09 or 17 ships to production
3. **BUG-09** — Add max-4 enforcement before settings language management is implemented
4. **BUG-07** — Fix type union before SRS notification feature is implemented
