# Task 32 — User Translation Template (Customizable Output)

**Status:** ✅ Done  
**Type:** Feature (new DB table + core types + bot scene + wiring)  
**Priority:** High — foundational config for all output-consuming features  
**Dependencies:** None (standalone)  
**Consumed by:** Task 33 (flash cards use the user's template for field visibility)

---

## Goal

Let users customize **what they see** in translation output. Instead of a fixed rendering, users compose their own template via a **constructor-style wizard** in the Telegram bot. The template controls:

1. **Which fields** are included in the AI response (`TranslationOutputConfig` — controls the prompt/schema)
2. **Which fields** are visible in the rendered Telegram card (display-level filtering)
3. **Layout preferences** — field ordering and formatting hints

The same template is the single source of truth for:
- Interactive translation output (`/translate`, plain text)
- Flash cards (Task 33 `PresentationConfig` → replaced by this)
- Notifications, quizzes, exports (future consumers)

### Default vs Custom

- **Default template** = current behavior (equivalent to `FULL_OUTPUT` preset). Applied automatically on first translation — zero setup required.
- **Custom template** = user-defined via constructor wizard. Available to **all users** now (premium gating deferred to a future milestone).

### Relationship to Task 33

Task 33 defines its own `PresentationConfig` with `showTranscription`, `showSynonyms`, etc. This task **replaces** that concept:

- Task 33's `PresentationConfig.fields` → absorbed into `UserTranslationTemplate.fields`
- Task 33's `FlashCardPresentationConfig` → stays separate (flash-card-specific: `frontSide`)
- Task 33's `FLASHCARD_CONFIG.presentation` → reads from `UserTranslationTemplate` + flash-card-specific overrides
- **Presets** (`FULL_OUTPUT`, `MINIMAL_OUTPUT`, etc.) remain as system defaults and internal-use configs — they are NOT user-facing templates

When Task 33 is implemented, it must:
1. Read the user's saved template from DB
2. Convert it to `TranslationOutputConfig` for the AI prompt
3. Use the field visibility flags for the flash card renderer
4. Allow the flash-card-specific `frontSide` override on top

---

## Target User Flow (Template Constructor Wizard)

```
User: /template
Bot: ⚙️ Translation Template
     Choose which sections to include in your translation output.
     Current template: Default (all sections)

     [📝 Customize]  [🔄 Reset to Default]

User: [📝 Customize]
Bot: 🔧 Template Constructor
     Toggle sections ON/OFF. Your preview updates live.

     ✅ Transcription [IPA]
     ✅ Synonyms
     ✅ Examples (3 sentences)
     ✅ Alternative translations
     ✅ Expression type notes
     ✅ Connotation warnings

     [👁 Preview]  [💾 Save]  [✕ Cancel]

User: taps "Synonyms" → toggles OFF
Bot: (updates inline keyboard)
     ✅ Transcription [IPA]
     ❌ Synonyms
     ✅ Examples (3 sentences)
     ✅ Alternative translations
     ✅ Expression type notes
     ✅ Connotation warnings

     [👁 Preview]  [💾 Save]  [✕ Cancel]

User: [👁 Preview]
Bot: 📋 Preview with your template:

     🍎 <b>apple</b>

     🇷🇺 RU: <b>яблоко</b> [ˈjabləkə]
     💬 <i>Я купил яблоко в магазине.</i> → нейтральный
     💬 <i>Кинь мне яблочко!</i> → разговорный
     💬 <i>Поставка яблок осуществляется еженедельно.</i> → деловой
        ∙ фрукт (нейтральный)
        ∙ плод (литературный)

     (No synonyms — disabled in your template)

     [← Back]

User: [💾 Save]
Bot: ✅ Template saved! All future translations will use this format.
```

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│           UserTranslationTemplate (DB + core type)           │
│   fields: { transcription, synonyms, examples, ... }         │
│   outputConfig: derived → TranslationOutputConfig             │
│   consumers: translation, flash cards, notifications, quiz    │
└────────────────────┬─────────────────────────────────────────┘
                     │
         ┌───────────┼───────────────┐
         │           │               │
  ┌──────▼──────┐  ┌─▼──────────┐  ┌▼──────────────┐
  │ Translation │  │ Flash Card │  │ Notification  │
  │ Renderer    │  │ Renderer   │  │ Renderer      │
  │ (Telegram)  │  │ (Task 33)  │  │ (future)      │
  └─────────────┘  └────────────┘  └───────────────┘
```

### Data flow

```
User saves template
  → DB: user_translation_templates row
  → On translate:
      1. Load template (cache in session or fetch per-request)
      2. Derive TranslationOutputConfig from template fields
      3. Pass to translate() → AI returns only requested fields
      4. Renderer uses same template to filter/format display
```

---

## What Is Already in Place (Do Not Re-Implement)

| Existing Feature | Location |
|---|---|
| `TranslationOutputConfig` interface | `packages/core/src/shared/types.ts` |
| Named presets (`FULL_OUTPUT`, `MINIMAL_OUTPUT`, etc.) | `packages/core/src/shared/translation-output.presets.ts` |
| `buildTranslationPrompt()` uses `outputConfig` | `packages/core/src/modules/translation/prompt.builder.ts` |
| `buildTranslationResultSchema()` uses `outputConfig` | `packages/core/src/modules/translation/schemas/translation.schema.ts` |
| `translate()` accepts `outputConfig` | `packages/core/src/modules/translation/translation.service.ts` |
| `renderTranslation()` renders full card | `apps/bot/src/renderers/translation.renderer.ts` |
| `handleTranslateText()` selects preset | `apps/bot/src/scenes/helpers/translate-mode.helper.ts` |
| Session data, BotContext | `apps/bot/src/types.ts` |
| `userLanguageSettings` table | `packages/adapters/db/src/schema.ts` |
| `userRepository` | `packages/adapters/db/src/repositories/user.repository.ts` |
| i18n `t()` function, locale files | `@polyglot/core` |

---

## Subtasks

---

### Step 1 — Core Types: `UserTranslationTemplate` and Conversion

**Location:** `packages/core/src/shared/translation-template.types.ts`

**Goal:** Define the user-facing template type and a function to convert it to `TranslationOutputConfig`.

- [x] Create `translation-template.types.ts`:

```typescript
import type { TranslationOutputConfig } from './types.js';

/**
 * Toggleable fields in a user's translation template.
 * Each field maps to a section in the translation output card.
 * true = show, false = hide.
 *
 * This is the USER-FACING config. It is simpler than TranslationOutputConfig
 * because some TranslationOutputConfig flags are always derived together.
 */
export interface TemplateFields {
  /** IPA transcription. Default: true */
  transcription: boolean;
  /** 2-3 synonyms per language. Default: true */
  synonyms: boolean;
  /** 3 contextual example sentences. Default: true */
  examples: boolean;
  /** Up to 2 alternative translation variants. Default: true */
  alternatives: boolean;
  /** Idiomatic expression type + equivalent note. Default: true */
  equivalentNote: boolean;
  /** Connotation warnings for dangerous meanings. Default: true */
  connotationWarning: boolean;
}

/**
 * A user's saved translation template.
 * Controls what is requested from AI AND what is rendered in output.
 */
export interface UserTranslationTemplate {
  /** Which output sections are enabled */
  fields: TemplateFields;
  /**
   * Template name shown to user. "Default" for system default.
   * Users can optionally rename their custom template.
   */
  name: string;
}

/** System default template — matches current FULL_OUTPUT behavior */
export const DEFAULT_TEMPLATE: UserTranslationTemplate = {
  name: 'Default',
  fields: {
    transcription: true,
    synonyms: true,
    examples: true,
    alternatives: true,
    equivalentNote: true,
    connotationWarning: true,
  },
};

/**
 * Convert a UserTranslationTemplate to TranslationOutputConfig.
 * This is the bridge between user-facing config and the AI pipeline.
 *
 * Note: includeCefr and includeRegister are NOT user-toggleable —
 * they follow the system presets (currently false in FULL_OUTPUT).
 * This keeps the user template simple while preserving system behavior.
 */
export function templateToOutputConfig(
  template: UserTranslationTemplate,
): TranslationOutputConfig {
  return {
    includeExamples: template.fields.examples,
    includeTranscription: template.fields.transcription,
    includeSynonyms: template.fields.synonyms,
    includeAlternatives: template.fields.alternatives,
    includeEquivalentNote: template.fields.equivalentNote,
    includeConnotationWarning: template.fields.connotationWarning,
    // System-controlled flags — not user-toggleable
    includeCefr: false,
    includeRegister: false,
  };
}

/** All toggleable field keys, in display order for the wizard */
export const TEMPLATE_FIELD_KEYS: Array<keyof TemplateFields> = [
  'transcription',
  'synonyms',
  'examples',
  'alternatives',
  'equivalentNote',
  'connotationWarning',
];
```

- [x] Export from `packages/core/src/shared/` barrel (if one exists) or add to `packages/core/src/index.ts`:
  ```typescript
  export * from './shared/translation-template.types.js';
  ```

---

### Step 2 — DB: `user_translation_templates` Table + Repository

**Location:**
- Schema: `packages/adapters/db/src/schema.ts`
- Migration: `packages/adapters/db/drizzle/0008_user_translation_templates.sql`
- Repository: `packages/adapters/db/src/repositories/translation-template.repository.ts`

**Goal:** Persist the user's custom template. One row per user (1-to-1 with `users`).

#### 2a — Schema addition

- [x] Add to `schema.ts`:

```typescript
export const userTranslationTemplates = pgTable('user_translation_templates', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .unique()
    .notNull(),
  /** User-given name for this template */
  name: text('name').notNull().default('Custom'),
  /** Template fields as JSONB — stored as TemplateFields */
  fields: jsonb('fields').$type<import('@polyglot/core').TemplateFields>().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

#### 2b — Migration

- [x] Write `0008_user_translation_templates.sql`:

```sql
CREATE TABLE IF NOT EXISTS "user_translation_templates" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "name" text NOT NULL DEFAULT 'Custom',
  "fields" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "user_translation_templates_user_id_idx"
  ON "user_translation_templates" ("user_id");
```

> **Note:** If another migration already took the 0008 slot, use 0009. Check at implementation time.

#### 2c — Repository

- [x] Create `translation-template.repository.ts`:

```typescript
export interface SavedTranslationTemplate {
  id: number;
  userId: number;
  name: string;
  fields: TemplateFields;
  createdAt: Date;
  updatedAt: Date;
}

export const translationTemplateRepository = {
  /**
   * Get the user's custom template, or null if they haven't set one.
   * When null, the caller should fall back to DEFAULT_TEMPLATE.
   */
  async getByUserId(userId: number): Promise<SavedTranslationTemplate | null>,

  /**
   * Upsert the user's template.
   * Creates if not exists, updates if exists.
   */
  async upsert(userId: number, name: string, fields: TemplateFields): Promise<SavedTranslationTemplate>,

  /**
   * Delete the user's custom template (reset to default).
   */
  async deleteByUserId(userId: number): Promise<void>,
};
```

#### 2d — Export from DB adapter

- [x] Add to `packages/adapters/db/src/index.ts`:
  ```typescript
  export type { SavedTranslationTemplate } from './repositories/translation-template.repository.js';
  export { translationTemplateRepository } from './repositories/translation-template.repository.js';
  ```

---

### Step 3 — Template Resolution Service

**Location:** `packages/core/src/shared/translation-template.service.ts`

**Goal:** Pure function that resolves "which template to use" for a given context. Keeps the resolution logic centralized instead of scattered across consumers.

- [x] Create `translation-template.service.ts`:

```typescript
import type { TranslationOutputConfig } from './types.js';
import {
  type UserTranslationTemplate,
  DEFAULT_TEMPLATE,
  templateToOutputConfig,
} from './translation-template.types.js';
import { SENTENCE_OUTPUT } from './translation-output.presets.js';

export type InputContext = 'word' | 'phrase' | 'sentence';

/**
 * Resolve the effective TranslationOutputConfig for a translation request.
 *
 * Rules:
 * 1. Sentences ALWAYS use SENTENCE_OUTPUT (compact, no learning metadata)
 * 2. Words/phrases use the user's custom template if set, otherwise DEFAULT_TEMPLATE
 *
 * @param userTemplate - The user's saved template, or null for default
 * @param inputContext - What kind of input is being translated
 */
export function resolveOutputConfig(
  userTemplate: UserTranslationTemplate | null,
  inputContext: InputContext,
): TranslationOutputConfig {
  // Sentences always use the compact preset — user template doesn't apply
  if (inputContext === 'sentence') {
    return SENTENCE_OUTPUT;
  }

  const template = userTemplate ?? DEFAULT_TEMPLATE;
  return templateToOutputConfig(template);
}

/**
 * Resolve the effective template (for rendering decisions).
 * Returns the user's custom template or the system default.
 */
export function resolveTemplate(
  userTemplate: UserTranslationTemplate | null,
): UserTranslationTemplate {
  return userTemplate ?? DEFAULT_TEMPLATE;
}
```

- [x] Export from `packages/core/src/index.ts`:
  ```typescript
  export { resolveOutputConfig, resolveTemplate } from './shared/translation-template.service.js';
  export type { InputContext } from './shared/translation-template.service.js';
  ```

---

### Step 4 — Renderer: Template-Aware Translation Rendering

**Location:** `apps/bot/src/renderers/translation.renderer.ts`

**Goal:** Make the existing renderer respect the user's template for display-level filtering. Currently, `renderTranslation()` always shows everything the AI returned. With this change, it checks `TemplateFields` to conditionally omit sections even if the AI included them (backward compatibility for stored translations with full data).

- [x] Add an optional `TemplateFields` parameter to `renderTranslation()`:

```typescript
export function renderTranslation(
  output: TranslateOutput,
  interfaceLang?: string,
  templateFields?: TemplateFields,  // NEW — optional, defaults to all-true
): string;
```

**Changes inside `renderTranslation()`:**
- If `templateFields` is provided, pass it to `renderLangBlock()`
- No breaking change: when `templateFields` is undefined, behavior is identical to current

- [x] Update `renderLangBlock()` to accept and use `TemplateFields`:

```typescript
function renderLangBlock(
  code: string,
  lt: LanguageTranslation,
  lang: SupportedLang,
  fields?: TemplateFields,  // NEW
): string;
```

**Conditional rendering:**
- `fields?.transcription === false` → omit `[transcription]` from header
- `fields?.synonyms === false` → omit `(syn1, syn2)` inline text
- `fields?.examples === false` → omit all `💬` example lines
- `fields?.alternatives === false` → omit all `∙ alternative` lines
- `fields?.equivalentNote === false` → omit `expressionType` / `equivalentNote` display (if ever rendered)
- `fields?.connotationWarning === false` → omit connotation warning line

> **Important:** When `fields` is undefined (no template), ALL sections are rendered — preserving backward compatibility.

---

### Step 5 — Bot: Template Constructor Wizard Scene

**Location:** `apps/bot/src/scenes/template.scene.ts`

**Goal:** Interactive wizard for composing a translation template via inline keyboard toggles.

#### Session state addition

- [x] Extend `SessionData` in `apps/bot/src/types.ts`:

```typescript
/** Template constructor wizard state */
templateWizard?: {
  /** Working copy of template fields being edited */
  fields: TemplateFields;
  /** Message ID of the wizard message (for in-place editing) */
  wizardMsgId?: number;
};
```

#### `/template` command handler

- [x] Register `/template` command:

```
1. Load user's template: translationTemplateRepository.getByUserId(userId)
2. If null → show DEFAULT_TEMPLATE info
3. Show current template summary + [📝 Customize] [🔄 Reset to Default] keyboard
```

#### Callback handlers

| Callback | Action |
|---|---|
| `tpl:customize` | Initialize `templateWizard` with current fields (from DB or default). Show the toggle keyboard. |
| `tpl:toggle:<fieldKey>` | Toggle the specified field in `session.templateWizard.fields`. Re-render the toggle keyboard in-place. |
| `tpl:preview` | Render a sample translation card using the current working-copy fields. Show [← Back] button. |
| `tpl:save` | Upsert `session.templateWizard.fields` to DB via `translationTemplateRepository.upsert()`. Clear wizard state. Show success message. |
| `tpl:cancel` | Clear `session.templateWizard`. Edit message to show "Cancelled" text. |
| `tpl:reset` | Delete user's template from DB via `translationTemplateRepository.deleteByUserId()`. Show confirmation that default is restored. |
| `tpl:back` | Return from preview to the toggle keyboard. |

#### Toggle keyboard layout

The wizard message shows a list of fields with their current toggle state. Each field is a button row:

```
[✅ Transcription [IPA]]        → callback: tpl:toggle:transcription
[✅ Synonyms]                    → callback: tpl:toggle:synonyms
[✅ Examples (3 sentences)]      → callback: tpl:toggle:examples
[✅ Alternative translations]    → callback: tpl:toggle:alternatives
[✅ Expression type notes]       → callback: tpl:toggle:equivalentNote
[✅ Connotation warnings]        → callback: tpl:toggle:connotationWarning
────────────────────────────────
[👁 Preview]  [💾 Save]  [✕ Cancel]
```

When a field is toggled OFF, the prefix changes to `❌`:
```
[❌ Synonyms]                    → callback: tpl:toggle:synonyms
```

#### Preview rendering

When the user taps `[👁 Preview]`:
1. Build a **mock `TranslateOutput`** with sample data (hardcoded example word, e.g., "apple" → "яблоко")
2. Call `renderTranslation(mockOutput, lang, session.templateWizard.fields)`
3. Show the rendered card with a `[← Back]` button

The mock data should be realistic enough for the user to see what each toggled-off section removes. Store the mock data as a constant in the scene file.

---

### Step 6 — Wire Template Into Translation Pipeline

**Location:** `apps/bot/src/scenes/helpers/translate-mode.helper.ts`

**Goal:** Replace the hardcoded `FULL_OUTPUT` / `SENTENCE_OUTPUT` selection with template-aware resolution.

- [x] In `handleTranslateText()`:

**Before (current):**
```typescript
const outputConfig = isSentence ? SENTENCE_OUTPUT : FULL_OUTPUT;
```

**After:**
```typescript
// Load user's template (null = default)
const userTemplate = await translationTemplateRepository.getByUserId(ctx.user.id);
const userTpl = userTemplate
  ? { name: userTemplate.name, fields: userTemplate.fields }
  : null;

// Resolve output config: sentences → SENTENCE_OUTPUT, words → user template
const outputConfig = resolveOutputConfig(userTpl, classification.type);
```

- [x] Pass template fields to the renderer:

**Before:**
```typescript
let card = renderTranslation(output, lang);
```

**After:**
```typescript
const effectiveTemplate = resolveTemplate(userTpl);
let card = renderTranslation(output, lang, effectiveTemplate.fields);
```

- [x] Apply the same pattern in `apps/bot/src/scenes/helpers/regen.helper.ts`:
  - Load user template
  - Use `resolveOutputConfig()` instead of hardcoded preset
  - Pass template fields to renderer

---

### Step 7 — i18n Keys

**Goal:** Add all template wizard UI strings to all 3 locale files.

- [x] Add to `packages/core/src/modules/i18n/locales/en.json`:

```json
{
  "templateTitle": "⚙️ Translation Template",
  "templateCurrent": "Current template: <b>{name}</b>",
  "templateDefault": "You're using the default template (all sections visible).",
  "templateCustom": "You have a custom template. Tap Customize to edit.",
  "templateCustomize": "📝 Customize",
  "templateReset": "🔄 Reset to Default",
  "templateConstructor": "🔧 Template Constructor\nToggle sections ON/OFF. Tap Preview to see the result.",
  "templatePreview": "👁 Preview",
  "templateSave": "💾 Save",
  "templateCancel": "✕ Cancel",
  "templateBack": "← Back",
  "templateSaved": "✅ Template saved! All future translations will use this format.",
  "templateResetDone": "🔄 Template reset to default. All sections are now visible.",
  "templateCancelled": "Template editing cancelled.",
  "templateFieldTranscription": "Transcription [IPA]",
  "templateFieldSynonyms": "Synonyms",
  "templateFieldExamples": "Examples (3 sentences)",
  "templateFieldAlternatives": "Alternative translations",
  "templateFieldEquivalentNote": "Expression type notes",
  "templateFieldConnotationWarning": "Connotation warnings",
  "templatePreviewHeader": "📋 Preview with your template:"
}
```

- [x] Add equivalent keys to `ru.json` (Russian translations)
- [x] Add equivalent keys to `cs.json` (Czech translations)

---

### Step 8 — Update Task 33 Integration Point

**Location:** `@docs/tasks/33-dictionary-word-pipeline-and-flashcards.md` (documentation only)

**Goal:** Document the integration so Task 33 implementers know to use the user template.

- [x] Add a note in Task 33's "Architecture Constraints" section:

> **User Template Integration (Task 32):**
> - `DictionaryWordConfig.presentation.fields` should be derived from the user's saved `UserTranslationTemplate` when available
> - The pipeline's `PresentationFields` type is intentionally aligned with `TemplateFields` — map 1:1
> - Flash-card-specific config (`frontSide`) is orthogonal and stays in `FlashCardPresentationConfig`
> - When building display data, use `resolveTemplate(userTemplate)` to get the effective field visibility

- [x] In Task 33's `PresentationFields`, note the relationship:

```
showTranscription  ← TemplateFields.transcription
showSynonyms       ← TemplateFields.synonyms
showExamples       ← TemplateFields.examples
showAlternatives   ← TemplateFields.alternatives
showCefr           ← system-controlled (not in TemplateFields)
showRegister       ← system-controlled (not in TemplateFields)
```

---

### Step 9 — Tests

#### Unit Tests — Core Types & Conversion

**Location:** `packages/core/src/shared/__tests__/translation-template.test.ts`

- [x] `templateToOutputConfig()`:
  - Default template → matches `FULL_OUTPUT` (minus `includeCefr`/`includeRegister` which are system-controlled)
  - Template with `examples: false` → `includeExamples: false`
  - Template with all fields false → all `include*` are false (except `includeCefr`/`includeRegister`)
  - System flags (`includeCefr`, `includeRegister`) are always false regardless of template

- [x] `resolveOutputConfig()`:
  - `inputContext: 'sentence'` → returns `SENTENCE_OUTPUT` regardless of user template
  - `inputContext: 'word'` with null template → returns default config
  - `inputContext: 'word'` with custom template → returns config from template
  - `inputContext: 'phrase'` behaves same as `'word'`

- [x] `resolveTemplate()`:
  - null input → returns `DEFAULT_TEMPLATE`
  - custom template → returns as-is

- [x] `DEFAULT_TEMPLATE`:
  - All fields are `true`
  - Name is `'Default'`

- [x] `TEMPLATE_FIELD_KEYS`:
  - Contains all 6 field keys
  - Order matches expected wizard display order

#### Unit Tests — Repository

**Location:** `packages/adapters/db/src/__tests__/translation-template.repository.test.ts`

- [x] `getByUserId()` for user with no template → returns `null`
- [x] `upsert()` creates a new template → returns saved template with correct fields
- [x] `upsert()` updates existing template → fields are updated, `updatedAt` changes
- [x] `deleteByUserId()` removes the template → subsequent `getByUserId()` returns `null`
- [x] `getByUserId()` returns correct `TemplateFields` shape from JSONB

#### Unit Tests — Renderer with Template

**Location:** `apps/bot/src/__tests__/translation.renderer.template.test.ts`

- [x] `renderTranslation()` without `templateFields` → renders all sections (backward compat)
- [x] `renderTranslation()` with `transcription: false` → no `[IPA]` in output
- [x] `renderTranslation()` with `synonyms: false` → no `(syn1, syn2)` inline
- [x] `renderTranslation()` with `examples: false` → no `💬` lines
- [x] `renderTranslation()` with `alternatives: false` → no `∙ alternative` lines
- [x] `renderTranslation()` with `connotationWarning: false` → no warning line
- [x] `renderTranslation()` with all fields false → only shows emoji, word, and bare translations

---

## Files to Create

| File | Description |
|---|---|
| `packages/core/src/shared/translation-template.types.ts` | `UserTranslationTemplate`, `TemplateFields`, `DEFAULT_TEMPLATE`, `templateToOutputConfig()` |
| `packages/core/src/shared/translation-template.service.ts` | `resolveOutputConfig()`, `resolveTemplate()` |
| `packages/core/src/shared/__tests__/translation-template.test.ts` | Core type + service tests |
| `packages/adapters/db/drizzle/0008_user_translation_templates.sql` | DB migration |
| `packages/adapters/db/src/repositories/translation-template.repository.ts` | Template CRUD repository |
| `packages/adapters/db/src/__tests__/translation-template.repository.test.ts` | Repository tests |
| `apps/bot/src/scenes/template.scene.ts` | Template constructor wizard (command + callbacks) |
| `apps/bot/src/__tests__/translation.renderer.template.test.ts` | Renderer template-aware tests |

## Files to Modify

| File | Change |
|---|---|
| `packages/core/src/index.ts` | Export `translation-template.types.ts` and `translation-template.service.ts` |
| `packages/adapters/db/src/schema.ts` | Add `userTranslationTemplates` table |
| `packages/adapters/db/src/index.ts` | Export `translationTemplateRepository` + types |
| `apps/bot/src/types.ts` | Add `templateWizard?: {...}` to `SessionData` |
| `apps/bot/src/renderers/translation.renderer.ts` | Add optional `TemplateFields` param to `renderTranslation()` and `renderLangBlock()` |
| `apps/bot/src/scenes/helpers/translate-mode.helper.ts` | Replace hardcoded `FULL_OUTPUT` with template-aware resolution |
| `apps/bot/src/scenes/helpers/regen.helper.ts` | Same: template-aware output config |
| `apps/bot/src/index.ts` | Register `/template` command + `tpl:*` callbacks |
| `packages/core/src/modules/i18n/locales/en.json` | Add `template*` i18n keys |
| `packages/core/src/modules/i18n/locales/ru.json` | Add `template*` i18n keys |
| `packages/core/src/modules/i18n/locales/cs.json` | Add `template*` i18n keys |
| `@docs/tasks/33-dictionary-word-pipeline-and-flashcards.md` | Add Task 32 integration notes |

---

## Architecture Constraints

| Rule | Details |
|---|---|
| No DB in core | `packages/core` must not import `@polyglot/adapter-db`. Template types and conversion live in `shared/`. |
| Named presets preserved | `FULL_OUTPUT`, `SENTENCE_OUTPUT`, etc. remain for internal use. `resolveOutputConfig()` is the new caller-facing API. |
| Backward compatibility | `renderTranslation()` without `templateFields` renders everything — no existing behavior changes. |
| One template per user | The DB table is 1-to-1 (unique on `user_id`). No multi-template support now. |
| Sentence override | Sentences ALWAYS use `SENTENCE_OUTPUT` — user template does not apply to sentences. |
| System-controlled fields | `includeCefr` and `includeRegister` are NOT user-toggleable. They follow system presets. |
| Template validation | `TemplateFields` must have all 6 boolean fields. Reject partial/malformed JSONB at repository level. |

---

## Edge Cases

| Scenario | Expected Behavior |
|---|---|
| User has no template in DB | `getByUserId()` returns null → `resolveOutputConfig()` uses `DEFAULT_TEMPLATE` → identical to current behavior |
| User disables ALL fields | Valid — they'll get bare translation text only (emoji + original + translated text per language). Warn in wizard: "Minimal output — only translations will be shown." |
| User resets to default | `deleteByUserId()` removes DB row → next translation uses `DEFAULT_TEMPLATE` |
| Sentence translation with custom template | Template is ignored — `SENTENCE_OUTPUT` always used (sentences are always compact) |
| Template in DB has missing fields (schema evolution) | Repository merges with `DEFAULT_TEMPLATE` fields: missing keys default to `true` |
| Concurrent template edits (two wizard sessions) | Last `upsert()` wins — acceptable for single-user bot |
| Flash card renderer (Task 33) | Reads user template, maps `TemplateFields` → `PresentationFields`. Falls back to all-true if no template. |
| Bot restart mid-wizard | `session.templateWizard` is lost. Callback handlers check for `session.templateWizard` and show "Session expired, use /template to restart." |

---

## Effort Estimate

~6–8 hours

---

## Acceptance Criteria

- [x] `UserTranslationTemplate` and `TemplateFields` types exported from `@polyglot/core`
- [x] `templateToOutputConfig()` correctly converts template fields to `TranslationOutputConfig`
- [x] `resolveOutputConfig()` returns `SENTENCE_OUTPUT` for sentences, user template config for words/phrases
- [x] `DEFAULT_TEMPLATE` has all 6 fields set to `true`
- [x] `user_translation_templates` table exists in DB with migration
- [x] `translationTemplateRepository.getByUserId()` returns null for users without custom template
- [x] `translationTemplateRepository.upsert()` creates/updates the template
- [x] `translationTemplateRepository.deleteByUserId()` removes the template
- [x] `/template` command shows current template status with Customize/Reset buttons
- [x] Template wizard shows toggle keyboard with all 6 fields
- [x] Tapping a field toggles it ON/OFF with visual indicator (✅/❌)
- [x] Preview shows a sample translation card respecting current toggle state
- [x] Save persists the template to DB and confirms to user
- [x] Reset deletes custom template and confirms default is restored
- [x] Interactive translation (`handleTranslateText()`) uses user's template instead of hardcoded `FULL_OUTPUT`
- [x] Regen handler uses user's template
- [x] `renderTranslation()` respects `TemplateFields` — disabled sections are not rendered
- [x] `renderTranslation()` without `templateFields` renders everything (backward compat)
- [x] All 3 locale files (en, ru, cs) have `template*` keys
- [x] Session loss mid-wizard shows "Session expired" message
- [x] All new tests pass: `pnpm -r run test`
- [x] All packages build: `pnpm -r run build`

---

## Future Extensions (Out of Scope Now)

| Feature | How to Add |
|---|---|
| Multiple named templates | Change DB to allow multiple rows per user (remove unique constraint). Add template selection UI. |
| Premium-only custom templates | Add `isPremium` check in `/template` command. Show "upgrade" message for free users. |
| Per-consumer template overrides | Add `consumer: 'translation' \| 'flashcard' \| 'notification'` column. Each consumer loads its own template. |
| Field ordering | Add `fieldOrder: Array<keyof TemplateFields>` to template. Renderer respects custom order. |
| Custom formatting (compact/detailed) | Add `displayMode: 'compact' \| 'detailed'` to template. Renderer adjusts whitespace/structure. |
| Template sharing | Export/import template as JSON. Users can share configs with friends. |
| CEFR/Register user toggle | Move `includeCefr`/`includeRegister` into `TemplateFields` when user demand warrants it. |
