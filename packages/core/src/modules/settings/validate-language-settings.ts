import { MAX_LEARNING_LANGS } from "./learning-langs.js";

export interface LanguageSettingsPatch {
  interfaceLang?: string;
  nativeLang?: string;
  learningLangs?: readonly string[];
}

type LanguageSettingsRejection =
  | "unknown_interface_lang"
  | "unknown_native_lang"
  | "unknown_learning_lang"
  | "learning_is_native"
  | "no_learning_langs"
  | "too_many_learning_langs";

export type LanguageSettingsValidation =
  | { ok: true; patch: { interfaceLang?: string; nativeLang?: string; learningLangs?: string[] } }
  | { ok: false; reason: LanguageSettingsRejection };

/**
 * One rule set for a language-settings write, shared by the bot's pickers and the
 * web settings form. Only the fields present are checked; learning languages are
 * checked against the native language the write leaves in place.
 */
export function validateLanguageSettings(
  patch: LanguageSettingsPatch,
  context: {
    currentNativeLang: string | null | undefined;
    /** A language the app can translate from and into. */
    isKnownLang: (code: string) => boolean;
    /** A language the interface is translated into (core i18n's `isSupported`). */
    isInterfaceLang: (code: string) => boolean;
  },
): LanguageSettingsValidation {
  if (patch.interfaceLang !== undefined && !context.isInterfaceLang(patch.interfaceLang)) {
    return { ok: false, reason: "unknown_interface_lang" };
  }
  if (patch.nativeLang !== undefined && !context.isKnownLang(patch.nativeLang)) {
    return { ok: false, reason: "unknown_native_lang" };
  }
  const result: { interfaceLang?: string; nativeLang?: string; learningLangs?: string[] } = {};
  if (patch.interfaceLang !== undefined) result.interfaceLang = patch.interfaceLang;
  if (patch.nativeLang !== undefined) result.nativeLang = patch.nativeLang;

  if (patch.learningLangs !== undefined) {
    const learningLangs = [...new Set(patch.learningLangs)];
    if (learningLangs.length === 0) return { ok: false, reason: "no_learning_langs" };
    if (learningLangs.length > MAX_LEARNING_LANGS) return { ok: false, reason: "too_many_learning_langs" };
    if (!learningLangs.every(context.isKnownLang)) return { ok: false, reason: "unknown_learning_lang" };
    const nativeLang = patch.nativeLang ?? context.currentNativeLang;
    if (nativeLang && learningLangs.includes(nativeLang)) return { ok: false, reason: "learning_is_native" };
    result.learningLangs = learningLangs;
  }
  return { ok: true, patch: result };
}
