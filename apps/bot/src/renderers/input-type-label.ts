import type { I18nKey, InputType, SupportedLang } from "@polyglot/core";
import { t } from "@polyglot/core";

const INPUT_TYPE_KEYS = {
  word: "inputTypeWord",
  phrase: "inputTypePhrase",
  sentence: "inputTypeSentence",
} as const satisfies Record<InputType, I18nKey>;

export function formatInputType(inputType: InputType, lang: SupportedLang): string {
  return t(INPUT_TYPE_KEYS[inputType], lang);
}
