/**
 * User Translation Template — user-facing config for controlling
 * which sections appear in translation output.
 *
 * This is the bridge between user preferences (simple toggles)
 * and the AI pipeline (TranslationOutputConfig).
 */
import type { TranslationOutputConfig } from "./types.js";

/**
 * Toggleable fields in a user's translation template.
 * Each field maps to a section in the translation output card.
 * true = show, false = hide.
 *
 * This is the USER-FACING config. It is simpler than TranslationOutputConfig
 * because some TranslationOutputConfig flags are always derived together.
 */
export interface TemplateFields {
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
  /** Constructional grammar breakdown for phrases/sentences. Default: false */
  grammarBreakdown: boolean;
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

/** System default template — learner-friendly but still light for cheap/small models */
export const DEFAULT_TEMPLATE: UserTranslationTemplate = {
  name: "Default",
  fields: {
    synonyms: true,
    examples: false,
    alternatives: true,
    equivalentNote: false,
    connotationWarning: false,
    grammarBreakdown: false,
  },
};

/**
 * Convert a UserTranslationTemplate to TranslationOutputConfig.
 * This is the bridge between user-facing config and the AI pipeline.
 */
export function templateToOutputConfig(template: UserTranslationTemplate): TranslationOutputConfig {
  return {
    includeExamples: template.fields.examples,
    includeSynonyms: template.fields.synonyms,
    includeAlternatives: template.fields.alternatives,
    includeEquivalentNote: template.fields.equivalentNote,
    includeUsageNote: true,
    includeConnotationWarning: template.fields.connotationWarning,
    includeNativeSynonyms: template.fields.synonyms,
    includeGrammarBreakdown: template.fields.grammarBreakdown,
  };
}

/** All toggleable field keys, in display order for the wizard */
export const TEMPLATE_FIELD_KEYS: Array<keyof TemplateFields> = [
  "synonyms",
  "examples",
  "alternatives",
  "equivalentNote",
  "connotationWarning",
  "grammarBreakdown",
];
