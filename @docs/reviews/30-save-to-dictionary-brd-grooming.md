# BRD Grooming Review — FEAT-30: Save to Dictionary
**Task reviewed:** `@docs/tasks/30-save-to-dictionary.md`  
**BRD reference:** `@docs/BRD.md`  
**Requirements reference:** `@docs/requirements/30-save-to-dictionary.md`  
**Date:** 2026-03-28  
**Reviewer:** brd-grooming agent

---

## Summary

The task list for FEAT-30 (T1–T10) correctly covers all BRD-mandated functional requirements for the Save to Dictionary feature: one-tap inline save, FK source language, input type column, duplicate detection, content sanitization, contextual button labels, and post-save regen keyboard. No task implements anything the BRD marks as out of scope or Post-MVP.

However, **five contradictions** were identified: three involve tasks making concrete implementation choices for BRD open questions that are explicitly marked as unresolved (one 🔴 Critical, two 🟡 Important), one involves an undocumented implicit architectural decision, and one involves a gap in the requirements-derived normalization behaviour.

---

## Contradiction #1

**BRD requirement (exact quote):**
> "**[FEAT-30/C1]** Is a breaking DB migration for `sourceLang → sourceLangId` FK acceptable? Need backfill strategy." — Open Questions table #11, Priority: 🔴 Critical

**Conflicting task:** T1 — Write DB Migration 0005

**Conflict:** The BRD explicitly marks the acceptability of the breaking `sourceLang → sourceLangId` migration as a 🔴 Critical unresolved open question requiring product-owner and architect sign-off, yet T1 fully implements the migration (backfill + NOT NULL enforcement) as if the question is settled.

**Severity:** Critical

**Recommendation:** Block T1 until the PO/architect formally resolves BRD C1 and records the decision in the BRD's Open Questions table. T1's backfill strategy (Step 3 UPDATE + Step 4 operator verification comment) is sound technically, but if any existing `words.source_lang` value has no matching `languages.code` row, Step 5 (`SET NOT NULL`) will fail at runtime with no automated fallback specified. The decision must be signed off and a NULL-row handling strategy documented before the migration file is committed. [needs PO review]

---

## Contradiction #2

**BRD requirement (exact quote):**
> "**[FEAT-30/C3]** Duplicate save: (A) show 'Already saved' + stop (Reverso-style), or (B) silently update existing entry with latest translation?" — Open Questions table #13, Priority: 🟡 Important

**Conflicting task:** T7 — Update handleSaveCallback(); T9 — Update handleRegenLoop()

**Conflict:** The BRD marks the duplicate-save behaviour as an open product question requiring explicit confirmation, but T7 and T9 both implement Option A ("Already in dictionary" toast + early return, no entry update) without the BRD recording a resolution. The requirements doc annotates this as "Recommendation: A — but product must confirm."

**Severity:** Major

**Recommendation:** The recommendation (Option A, Reverso-style) is reasonable and aligns with competitor benchmarks cited in the BRD. The PO should formally confirm Option A and update Open Questions table #13 to ✅ Resolved before T7/T9 are merged. If Option B is chosen instead (silent update on duplicate), T7/T9 acceptance criteria must be rewritten. [needs PO review]

---

## Contradiction #3

**BRD requirement (exact quote):**
> "**[FEAT-30/C5]** Post-save regen: (A) auto-update saved entry silently, (B) revert to unsaved state, or (C) prompt to re-save?" — Open Questions table #15, Priority: 🟡 Important

**Conflicting task:** T8 — Update handleRegenCallback() + handleTranslateText(); T9 — Update handleRegenLoop()

**Conflict:** The BRD marks post-save regen behaviour as an open product question, but T8 and T9 both implement Option A (every regen call after save silently calls `wordRepository.updateContent()` and keeps `savedWordId` set) without the BRD recording a resolution. The requirements doc annotates this as "Recommendation: A (auto-update via updateContent), but this is a product decision."

**Severity:** Major

**Recommendation:** The recommendation (Option A) is consistent with the BRD's stated goal of "allowing translation refinement of the saved entry" (BRD §6.1). The PO should confirm Option A and close Open Questions #15 before T8/T9 are merged. If Option B or C is chosen, the session management logic in T8 (retaining `savedWordId` through regens) and the regen keyboard choice in T9 must change significantly. [needs PO review]

---

## Contradiction #4

**BRD requirement (exact quote):**
> "**[FEAT-30/C2]** Add `word_target_langs` junction table for target language FK integrity (Option A), or validate JSONB keys at write time (Option B)?" — Open Questions table #12, Priority: 🟠 Medium

**Conflicting task:** T2 — Update Drizzle Schema + Define StoredWordContent Types; T3 — Update wordRepository

**Conflict:** The BRD lists target-language FK integrity as an open architectural question, but the task set implicitly resolves it as Option B (JSONB keys typed via `StoredLanguageTranslation` in TypeScript, no junction table) without explicitly acknowledging this as a decision. Neither T2 nor T3 reference C2 or document why the junction table approach was deferred.

**Severity:** Minor

**Recommendation:** The research recommendation favours Option B for now (the BRD's requirements doc notes "Option B for now; Option A in v2"). Add a comment to T2's acceptance criteria explicitly stating: "Target-language FK integrity uses TypeScript type enforcement (Option B per BRD C2); `word_target_langs` junction table deferred to FEAT-30.1." This documents the choice without blocking implementation. [needs PO review]

---

## Contradiction #5

**BRD requirement (exact quote):**
> "Duplicate detection: tapping Save on an already-saved word shows 'Already in dictionary' instead of creating a duplicate entry" — BRD §6.1

*The associated requirements document (`@docs/requirements/30-save-to-dictionary.md`) is referenced by the BRD via "See detailed requirements: `@docs/requirements/30-save-to-dictionary.md` (FEAT-30)" and specifies REQ-3010: "The `original` value is trimmed of leading/trailing whitespace before save and before duplicate lookup. At minimum: whitespace trim is applied."*

**Conflicting task:** T3 — Update wordRepository; T7 — Update handleSaveCallback(); T9 — Update handleRegenLoop()

**Conflict:** The requirements document referenced by the BRD mandates at minimum whitespace normalization of `original` text before save and before the duplicate lookup. None of T3, T7, or T9 include a normalization step: T3's `findByOriginalAndSource` acceptance criteria specifies an exact-match query with no mention of `TRIM()` or `LOWER()`; T7's save flow passes `output.original` directly to the repository without trimming. This means "hello " and "hello" would create two separate dictionary entries, silently bypassing the duplicate detection the BRD mandates.

**Severity:** Minor

**Recommendation:** Add to T7's acceptance criteria: "Before calling `findByOriginalAndSource` and `create()`, normalize `output.original` with `output.original.trim()`." Add the same normalization note to T9. Case-insensitive dedup (`LOWER()`) is explicitly deferred to FEAT-30.1 per the requirements doc and need not be added here, but whitespace trim is marked as a minimum requirement and must be included in the current scope.

---

## No Further Contradictions Found

All other BRD-mandated requirements for FEAT-30 are correctly implemented:

| BRD Requirement | Task(s) | Status |
|---|---|---|
| One-tap inline save (word/phrase only) | T7 | ✅ |
| Save button hidden for `sentence` type (no regression on Task 27) | T6, T7 | ✅ |
| Save button label: "💾 Save word" / "💾 Save phrase" | T4, T6 | ✅ |
| Source language stored as FK to `languages` table | T1, T2, T3 | ✅ |
| Input type stored as dedicated column (`word`/`phrase` only) | T1, T2, T3 | ✅ |
| Internal pipeline fields excluded from stored content | T5 | ✅ |
| Post-save keyboard: regen-only (Save/Skip removed) | T6, T7 | ✅ |
| `savedToDict` / `alreadySaved` i18n keys (already in locale files) | — | ✅ already present |
| Sentence input type never passed to `wordRepository.create()` | T7, T9, Architecture Constraints | ✅ |
| Browse/edit/SRS scheduling correctly excluded (Post-MVP) | All tasks | ✅ |
