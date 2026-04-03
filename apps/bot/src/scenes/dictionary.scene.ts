/**
 * Dictionary scene — /dictionary command handler.
 *
 * Shows the user's personal dictionary as a paginated list.
 * All DB access through repositories. All text via i18n.
 */

import { userRepository, vocabularyRepository } from "@polyglot/adapter-db";
import type { SupportedLang } from "@polyglot/core";
import { isSupported, t } from "@polyglot/core";
import {
  buildDictionaryListKeyboard,
  DICTIONARY_PAGE_SIZE,
  renderDictionaryList,
} from "../renderers/dictionary.renderer.js";
import type { BotContext } from "../types.js";

/** Resolve user's interface language. */
async function getUserLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await userRepository.getSettings(ctx.user.id);
  const lang = settings?.interfaceLang;
  return lang && isSupported(lang) ? lang : "en";
}

/** /dictionary command — show the user's personal dictionary. */
export async function handleDictionaryCommand(ctx: BotContext): Promise<void> {
  const lang = await getUserLang(ctx);
  const total = await vocabularyRepository.countByUser(ctx.user.id);

  if (total === 0) {
    await ctx.reply(t("emptyDictionary", lang));
    return;
  }

  const entries = await vocabularyRepository.findByUserPaginated(ctx.user.id, 0, DICTIONARY_PAGE_SIZE);
  const totalPages = Math.ceil(total / DICTIONARY_PAGE_SIZE);

  const text = renderDictionaryList(entries, 1, totalPages, total, lang);
  const kb = buildDictionaryListKeyboard(entries, 1, totalPages, lang);

  const msg = await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });

  ctx.session.dictionary = {
    currentPage: 1,
    msgId: msg.message_id,
  };
}
