/**
 * Dictionary scene — /dictionary command handler.
 *
 * Shows the user's personal dictionary as a paginated list.
 * All DB access through repositories. All text via i18n.
 */

import type { SupportedLang } from "@polyglot/core";
import { isSupported } from "@polyglot/core";
import {
  buildDictionaryListKeyboard,
  DICTIONARY_PAGE_SIZE,
  renderDictionaryList,
} from "../renderers/dictionary.renderer.js";
import type { BotContext } from "../types.js";
import { replyTechnical } from "../utils/message-cleanup.js";

/** Resolve user's interface language. */
async function getUserLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const lang = settings?.interfaceLang;
  return lang && isSupported(lang) ? lang : "en";
}

/** /dictionary command — show the user's personal dictionary. */
export async function handleDictionaryCommand(ctx: BotContext): Promise<void> {
  const lang = await getUserLang(ctx);
  const dictionary = await ctx.services.vocabularyDictionaryRepository.getOrCreateDefault(ctx.user.id);
  const total = await ctx.services.vocabularyRepository.countByUser(ctx.user.id, dictionary.id);

  const entries = await ctx.services.vocabularyRepository.findByUserPaginated(
    ctx.user.id,
    0,
    DICTIONARY_PAGE_SIZE,
    dictionary.id,
  );
  const totalPages = Math.max(1, Math.ceil(total / DICTIONARY_PAGE_SIZE));

  const text = renderDictionaryList(entries, 1, totalPages, total, lang, dictionary.name);
  const kb = buildDictionaryListKeyboard(entries, 1, totalPages, lang, dictionary.id);

  const msg = await replyTechnical(ctx, text, { parse_mode: "HTML", reply_markup: kb });

  ctx.session.dictionary = {
    currentPage: 1,
    dictionaryId: dictionary.id,
    msgId: msg.message_id,
  };
}
