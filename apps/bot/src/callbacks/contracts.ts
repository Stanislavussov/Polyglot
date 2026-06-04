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
    prefix: "tr:srclang",
    restartSafety: "stateless-restorable",
    durableLookupKey: "language code",
    dbSource: "user_language_settings.last_source_lang",
    expiryBehavior: "ignore invalid language and answer callback",
    maxExampleData: "tr:srclang:zh-Hant",
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
    durableLookupKey: "page number",
    dbSource: "vocabulary_entries scoped by user id",
    expiryBehavior: "re-render page from DB; no session required",
    maxExampleData: "dict:page:2147483647",
  },
  {
    family: "dictionary",
    prefix: "dict:view",
    restartSafety: "stateless-restorable",
    durableLookupKey: "entry id and optional page number",
    dbSource: "vocabulary_entries and vocabulary_translations scoped by owner",
    expiryBehavior: "localized noResults if missing or not owned",
    maxExampleData: "dict:view:2147483647:2147483647",
  },
  {
    family: "dictionary",
    prefix: "dict:delete",
    restartSafety: "stateless-restorable",
    durableLookupKey: "entry id and current page when present",
    dbSource: "vocabulary_entries scoped by owner",
    expiryBehavior: "localized noResults if missing or not owned",
    maxExampleData: "dict:delete:2147483647:2147483647",
  },
  {
    family: "dictionary",
    prefix: "dict:confirm-delete",
    restartSafety: "stateless-restorable",
    durableLookupKey: "entry id and page number",
    dbSource: "vocabulary_entries scoped by owner, then hard delete",
    expiryBehavior: "localized noResults if missing or not owned",
    maxExampleData: "dict:confirm-delete:2147483647:2147483647",
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
    durableLookupKey: "notification action",
    dbSource: "notification history where applicable",
    expiryBehavior: "answer callback and remove stale keyboard when possible",
    maxExampleData: "notif:open",
  },
] as const satisfies readonly CallbackContract[];

export function getCallbackDataByteLength(data: string): number {
  return Buffer.byteLength(data, "utf8");
}

export function isValidTelegramCallbackData(data: string): boolean {
  return getCallbackDataByteLength(data) <= MAX_TELEGRAM_CALLBACK_DATA_BYTES;
}

export { MAX_TELEGRAM_CALLBACK_DATA_BYTES };
