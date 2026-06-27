# BUG-03: Tasks 09 & 17 Both Resolve "Next Translation" Button with Conflicting Definitions

**Severity:** 🟠 Major  
**Source Tasks:** Task 09 (`@docs/tasks/09-translate-session-loop.md`), Task 17 (`@docs/tasks/17-next-translation-language-menu.md`)  
**BRD Reference:** §9 Action Buttons — "✨ Next translation" (Open Question #1)  
**Status:** ✅ Resolved

---

## Problem

Both Task 09 and Task 17 claim to resolve BRD Open Question #1 ("What does '✨ Next translation' button do?"), but they define the feature **differently** and without resolving the BRD open question:

**Task 09 interpretation** — "Next translation" = persistent translate mode:
> "BRD §9 ('✨ Next translation' button — open question, resolved by this task)"
> The resolution is: the bot enters translate mode where every message is auto-translated — no explicit button needed.

**Task 17 interpretation** — "Next translation" = post-translation source language menu:
> "BRD §9 ('✨ Next translation' button — TBD, resolved by this task)"
> The resolution is: a source language selection keyboard shown after Save/Skip.

These are **incompatible answers** to the same open question. The BRD still formally marks this as TBD:

> **✨ Next translation**
> **Status: TBD** — see [Section 14](open-questions)

BRD Open Question #1 is rated 🔴 **Critical priority** as it blocks topic and notification development.

---

## Root Cause

Both tasks were written and merged without first resolving the BRD open question through a product decision. Each task author independently interpreted the button's purpose and claimed resolution without cross-referencing the other task.

---

## Files Affected

- `@docs/tasks/09-translate-session-loop.md` — incorrectly claims to resolve Open Question #1
- `@docs/tasks/17-next-translation-language-menu.md` — incorrectly claims to resolve Open Question #1
- `@docs/BRD.md` — Open Question #1 must be formally resolved and removed from the TBD table

---

## Acceptance Criteria

- [x] BRD Open Question #1 ("What does '✨ Next translation' button do?") is formally answered with a product decision documented in `@docs/BRD.md` Section 9
- [x] One of the following outcomes is selected and documented:
  - **Option A:** The "✨ Next translation" button triggers translate mode (Task 09's interpretation) — Task 17's source language menu is a separate feature not tied to this button
  - **Option B:** The "✨ Next translation" button opens a source language selector (Task 17's interpretation) — Task 09's persistent mode is the underlying mechanism, not the button's definition
  - **Option C:** The button is removed from the BRD — persistent translate mode (Task 09) already makes it redundant
- [x] Task 09 and Task 17 are updated to reference the resolved definition without claiming to resolve the open question independently
- [x] No conflicting documentation remains across both task files and the BRD

---

## Notes

- The BRD §9 button layout shows "✨ Next translation" as a standalone action button, distinct from Save/Skip. Task 17's source language menu appears after Save/Skip — these may be two separate UX elements
- Priority is 🔴 Critical in the BRD because the ambiguity also affects notification and topic development
