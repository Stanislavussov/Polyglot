import type { NotificationPayload } from "@polyglot/adapter-notifications";
import { type SupportedLang, t } from "@polyglot/core";

/** What the web app's service worker shows; `url` is the page a tap opens. */
export interface WebPushMessage {
  title: string;
  body: string;
  url: string;
  /** One slot per kind: a newer reminder replaces an unread one instead of piling up. */
  tag: string;
}

const APP_NAME = "Polyglot";

/** System notifications render plain text only, so Telegram's HTML must not leak into them. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

export function formatWordPush(payload: NotificationPayload, lang: SupportedLang): WebPushMessage {
  const expression = payload.word.expression;
  if (expression) {
    return { title: APP_NAME, body: expression.expression, url: "/", tag: "polyglot-word" };
  }
  const deckSize = payload.deck?.length ?? 0;
  const word = payload.word.headword ?? payload.word.original;
  return {
    title: t("webPushWordTitle", lang),
    body: deckSize > 1 ? t("webPushDeckBody", lang, { count: deckSize }) : t("webPushWordBody", lang, { word }),
    url: "/review/",
    tag: "polyglot-word",
  };
}

export function formatEmptyDictionaryPush(lang: SupportedLang): WebPushMessage {
  return { title: APP_NAME, body: t("webPushEmptyDictionaryBody", lang), url: "/translate/", tag: "polyglot-word" };
}

export function formatReEngagementPush(messageHtml: string): WebPushMessage {
  return { title: APP_NAME, body: stripHtml(messageHtml), url: "/", tag: "polyglot-comeback" };
}
