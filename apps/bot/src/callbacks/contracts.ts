export type CallbackRestartSafetyClass = "stateless-restorable" | "session-backed" | "intentionally-ephemeral";

export interface CallbackContract {
  family: "translation" | "flashcard" | "srs" | "dictionary" | "template" | "settings" | "notification";
  prefix: string;
  restartSafety: CallbackRestartSafetyClass;
  durableLookupKey: string;
  dbSource: string;
  expiryBehavior: string;
  maxExampleData: string;
}

const MAX_TELEGRAM_CALLBACK_DATA_BYTES = 64;

export const callbackContracts = [
  {
    family: "translation",
    prefix: "tr:save",
    restartSafety: "session-backed",
    durableLookupKey: "currently Telegram message_id; target is translationRequestId",
    dbSource: "translation_requests plus pending translation snapshot storage from Task 61 follow-up",
    expiryBehavior: "localized stale translation callback and stale callback metric",
    maxExampleData: "tr:save:2147483647",
  },
  {
    family: "translation",
    prefix: "tr:skip",
    restartSafety: "session-backed",
    durableLookupKey: "currently Telegram message_id; target is translationRequestId",
    dbSource: "translation_requests plus pending translation snapshot storage from Task 61 follow-up",
    expiryBehavior: "localized stale translation callback and stale callback metric",
    maxExampleData: "tr:skip:2147483647",
  },
  {
    family: "translation",
    prefix: "tr:regen",
    restartSafety: "session-backed",
    durableLookupKey: "target language code plus currently Telegram message_id",
    dbSource: "translation_requests plus vocabulary rows when savedWordId exists",
    expiryBehavior: "localized stale translation callback and stale callback metric",
    maxExampleData: "tr:regen:zh-Hant:2147483647",
  },
  {
    family: "translation",
    prefix: "tr:clarifypost",
    restartSafety: "session-backed",
    durableLookupKey: "Telegram message_id",
    dbSource: "session translationMap",
    expiryBehavior: "localized stale translation callback",
    maxExampleData: "tr:clarifypost:2147483647",
  },
  {
    family: "translation",
    prefix: "tr:altmeaning",
    restartSafety: "session-backed",
    durableLookupKey: "Telegram message_id",
    dbSource: "session translationMap",
    expiryBehavior: "localized stale translation callback",
    maxExampleData: "tr:altmeaning:2147483647",
  },
  {
    family: "translation",
    prefix: "tr:grammar",
    restartSafety: "session-backed",
    durableLookupKey: "Telegram message_id",
    dbSource: "session translationMap",
    expiryBehavior: "localized stale translation callback",
    maxExampleData: "tr:grammar:2147483647",
  },
  {
    family: "translation",
    prefix: "tr:gramdetail",
    restartSafety: "session-backed",
    durableLookupKey: "Telegram message_id",
    dbSource: "session translationMap",
    expiryBehavior: "localized stale translation callback",
    maxExampleData: "tr:gramdetail:2147483647",
  },
  {
    family: "translation",
    prefix: "tr:gramlang",
    restartSafety: "session-backed",
    durableLookupKey: "language code and Telegram message_id",
    dbSource: "session translationMap",
    expiryBehavior: "localized stale translation callback",
    maxExampleData: "tr:gramlang:de:2147483647",
  },
  {
    family: "translation",
    prefix: "tr:mistype",
    restartSafety: "intentionally-ephemeral",
    durableLookupKey: "none",
    dbSource: "none",
    expiryBehavior: "localized stale translation callback",
    maxExampleData: "tr:mistype:confirm",
  },
  {
    family: "translation",
    prefix: "tr:langselect",
    restartSafety: "intentionally-ephemeral",
    durableLookupKey: "none",
    dbSource: "none",
    expiryBehavior: "localized stale translation callback",
    maxExampleData: "tr:langselect:cs",
  },
  {
    family: "translation",
    prefix: "tr:clarify",
    restartSafety: "intentionally-ephemeral",
    durableLookupKey: "none",
    dbSource: "none",
    expiryBehavior: "localized stale translation callback",
    maxExampleData: "tr:clarify:option:12",
  },
  {
    family: "flashcard",
    prefix: "fc",
    restartSafety: "session-backed",
    durableLookupKey: "target is deck/session id plus card id",
    dbSource: "vocabulary_entries, vocabulary_translations, word_review_log",
    expiryBehavior: "localized flashcardSessionExpired",
    maxExampleData: "fc:reveal",
  },
  {
    family: "srs",
    prefix: "srs:rate",
    restartSafety: "session-backed",
    durableLookupKey: "target is vocabulary_translation id plus rating",
    dbSource: "vocabulary_translations SRS columns",
    expiryBehavior: "localized srsSessionExpired",
    maxExampleData: "srs:rate:again",
  },
  {
    family: "srs",
    prefix: "srs",
    restartSafety: "session-backed",
    durableLookupKey: "target is review session id plus card id",
    dbSource: "vocabulary_translations SRS columns",
    expiryBehavior: "localized srsSessionExpired",
    maxExampleData: "srs:reveal",
  },
  {
    family: "dictionary",
    prefix: "dict:page",
    restartSafety: "stateless-restorable",
    durableLookupKey: "dictionary id and page number",
    dbSource: "vocabulary_dictionaries plus vocabulary_entries scoped by user id",
    expiryBehavior: "re-render page from DB; no session required",
    maxExampleData: "dict:page:2147483647:2147483647",
  },
  {
    family: "dictionary",
    prefix: "dict:view",
    restartSafety: "stateless-restorable",
    durableLookupKey: "dictionary id, entry id, and optional page number",
    dbSource: "vocabulary_dictionaries, vocabulary_entries, and vocabulary_translations scoped by owner",
    expiryBehavior: "localized noResults if missing or not owned",
    maxExampleData: "dict:view:2147483647:2147483647:2147483647",
  },
  {
    family: "dictionary",
    prefix: "dict:delete",
    restartSafety: "stateless-restorable",
    durableLookupKey: "dictionary id, entry id, and current page when present",
    dbSource: "vocabulary_dictionary_entries scoped by owner",
    expiryBehavior: "localized noResults if missing or not owned",
    maxExampleData: "dict:delete:2147483647:2147483647:2147483647",
  },
  {
    family: "dictionary",
    prefix: "dict:confirm-delete",
    restartSafety: "stateless-restorable",
    durableLookupKey: "dictionary id, entry id, and page number",
    dbSource: "vocabulary_dictionary_entries scoped by owner, then hard delete if last membership",
    expiryBehavior: "localized noResults if missing or not owned",
    maxExampleData: "dict:confirm-delete:2147483647:2147483647:2147483647",
  },
  {
    family: "dictionary",
    prefix: "dict:list",
    restartSafety: "stateless-restorable",
    durableLookupKey: "user id",
    dbSource: "vocabulary_dictionaries scoped by user id",
    expiryBehavior: "re-render dictionary switcher from DB",
    maxExampleData: "dict:list",
  },
  {
    family: "dictionary",
    prefix: "dict:open",
    restartSafety: "stateless-restorable",
    durableLookupKey: "dictionary id",
    dbSource: "vocabulary_dictionaries scoped by user id",
    expiryBehavior: "localized noResults if missing or not owned",
    maxExampleData: "dict:open:2147483647",
  },
  {
    family: "dictionary",
    prefix: "dict:add",
    restartSafety: "stateless-restorable",
    durableLookupKey: "source dictionary id, entry id, target dictionary id, page",
    dbSource: "vocabulary_dictionary_entries scoped by owner",
    expiryBehavior: "localized noResults if missing or not owned",
    maxExampleData: "dict:add:2147483647:2147483647:2147483647:2147483647",
  },
  {
    family: "dictionary",
    prefix: "dict:move",
    restartSafety: "stateless-restorable",
    durableLookupKey: "source dictionary id, entry id, target dictionary id, page",
    dbSource: "vocabulary_dictionary_entries scoped by owner",
    expiryBehavior: "localized noResults if missing or not owned",
    maxExampleData: "dict:move:2147483647:2147483647:2147483647:2147483647",
  },
  {
    family: "dictionary",
    prefix: "dict:close",
    restartSafety: "stateless-restorable",
    durableLookupKey: "none",
    dbSource: "none",
    expiryBehavior: "delete message; ignore already-deleted messages",
    maxExampleData: "dict:close",
  },
  {
    family: "template",
    prefix: "tpl",
    restartSafety: "intentionally-ephemeral",
    durableLookupKey: "none",
    dbSource: "translation_templates only on save",
    expiryBehavior: "localized templateSessionExpired",
    maxExampleData: "tpl:toggle:connotationWarning",
  },
  {
    family: "settings",
    prefix: "set",
    restartSafety: "stateless-restorable",
    durableLookupKey: "selected setting value",
    dbSource: "user_language_settings and notification settings",
    expiryBehavior: "localized settingsSessionExpired when awaiting text context is gone",
    maxExampleData: "set:notif:time:23:59",
  },
  {
    family: "notification",
    prefix: "notif",
    restartSafety: "stateless-restorable",
    durableLookupKey: "vocabulary entry id",
    dbSource: "vocabulary entries + notification history",
    expiryBehavior: "answer callback and remove stale keyboard when possible",
    maxExampleData: "notif:reveal:123",
  },
] as const satisfies readonly CallbackContract[];

export function getCallbackDataByteLength(data: string): number {
  return Buffer.byteLength(data, "utf8");
}

export function isValidTelegramCallbackData(data: string): boolean {
  return getCallbackDataByteLength(data) <= MAX_TELEGRAM_CALLBACK_DATA_BYTES;
}

export { MAX_TELEGRAM_CALLBACK_DATA_BYTES };
