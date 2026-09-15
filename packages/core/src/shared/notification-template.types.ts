/**
 * What an opened word notification shows besides the word and the recall question.
 *
 * Only aids that cannot hand over the answer qualify — the same rule as the card
 * front (`card-template.types.ts`). Extras render below the question, so a phone's
 * push preview, which shows the first lines only, still reads word + question.
 */
export interface NotificationTemplateFields {
  /** Source-language synonyms of the word, on their own line under the question. */
  synonyms: boolean;
}

/** Off by default: a notification is a bare recall prompt until the user asks for more. */
export const DEFAULT_NOTIFICATION_TEMPLATE_FIELDS: Readonly<NotificationTemplateFields> = Object.freeze({
  synonyms: false,
});

/** Toggleable keys in settings display order. */
export const NOTIFICATION_TEMPLATE_FIELD_KEYS: ReadonlyArray<keyof NotificationTemplateFields> = ["synonyms"];

export function isNotificationTemplateField(value: string): value is keyof NotificationTemplateFields {
  return (NOTIFICATION_TEMPLATE_FIELD_KEYS as readonly string[]).includes(value);
}
