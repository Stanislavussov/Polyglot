/**
 * Dictionary callback handlers — dict:* callbacks for dictionary browsing.
 *
 * Handles: page navigation, view entry, delete, confirm delete, close, noop.
 * All DB access through repositories. All text via i18n.
 */

import { getAllLangs, userRepository, vocabularyRepository } from "@polyglot/adapter-db";
import type { SupportedLang } from "@polyglot/core";
import { isSupported, t } from "@polyglot/core";
import { logger } from "@polyglot/infra";
import {
  buildDeleteConfirmKeyboard,
  buildDictionaryEntryKeyboard,
  buildDictionaryListKeyboard,
  DICTIONARY_PAGE_SIZE,
  renderDictionaryEntry,
  renderDictionaryList,
} from "../../renderers/dictionary.renderer.js";
import type { BotContext } from "../../types.js";

/* ── Language resolution ───────────────────────────────────────── */

function getLangCodeById(id: number): string | undefined {
  const all = getAllLangs();
  return all.find((l) => l.id === id)?.code;
}

async function getUserLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await userRepository.getSettings(ctx.user.id);
  const lang = settings?.interfaceLang;
  return lang && isSupported(lang) ? lang : "en";
}

/* ── Session check ─────────────────────────────────────────────── */

async function answerExpired(ctx: BotContext): Promise<void> {
  const lang = await getUserLang(ctx);
  try {
    await ctx.answerCallbackQuery({ text: t("dictionarySessionExpired", lang) });
  } catch {
    /* ignore */
  }
}

/* ── dict:page:{n} ─────────────────────────────────────────────── */

export async function handleDictPage(ctx: BotContext): Promise<void> {
  const dict = ctx.session.dictionary;
  if (!dict) { await answerExpired(ctx); return; }

  const data = ctx.callbackQuery?.data ?? "";
  const page = parseInt(data.split(":")[2] ?? "1", 10);
  if (isNaN(page) || page < 1) return void ctx.answerCallbackQuery();

  const lang = await getUserLang(ctx);
  const total = await vocabularyRepository.countByUser(ctx.user.id);
  const totalPages = Math.ceil(total / DICTIONARY_PAGE_SIZE);

  if (total === 0) {
    try {
      await ctx.editMessageText(t("emptyDictionary", lang), { reply_markup: undefined });
    } catch (err) {
      logger.error({ err }, "Failed to edit dictionary message");
    }
    ctx.session.dictionary = undefined;
    return void ctx.answerCallbackQuery();
  }

  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * DICTIONARY_PAGE_SIZE;
  const entries = await vocabularyRepository.findByUserPaginated(ctx.user.id, offset, DICTIONARY_PAGE_SIZE);

  const text = renderDictionaryList(entries, safePage, totalPages, total, lang);
  const kb = buildDictionaryListKeyboard(entries, safePage, totalPages, lang);

  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
  } catch (err) {
    logger.error({ err }, "Failed to edit dictionary message");
  }

  dict.currentPage = safePage;
  await ctx.answerCallbackQuery();
}

/* ── dict:view:{entryId} or dict:view:{entryId}:{page} ────────── */

export async function handleDictView(ctx: BotContext): Promise<void> {
  const dict = ctx.session.dictionary;
  if (!dict) { await answerExpired(ctx); return; }

  const data = ctx.callbackQuery?.data ?? "";
  const parts = data.split(":");
  const entryId = parseInt(parts[2] ?? "0", 10);
  const page = parts[3] ? parseInt(parts[3], 10) : dict.currentPage;

  const lang = await getUserLang(ctx);
  const entry = await vocabularyRepository.findById(entryId);

  if (!entry) {
    await ctx.answerCallbackQuery({ text: t("noResults", lang) });
    return;
  }

  const text = renderDictionaryEntry(entry, getLangCodeById, lang);
  const kb = buildDictionaryEntryKeyboard(entryId, page, lang);

  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
  } catch (err) {
    logger.error({ err }, "Failed to edit dictionary message");
  }
  await ctx.answerCallbackQuery();
}

/* ── dict:delete:{entryId} ─────────────────────────────────────── */

export async function handleDictDelete(ctx: BotContext): Promise<void> {
  const dict = ctx.session.dictionary;
  if (!dict) { await answerExpired(ctx); return; }

  const data = ctx.callbackQuery?.data ?? "";
  const entryId = parseInt(data.split(":")[2] ?? "0", 10);

  const lang = await getUserLang(ctx);
  const entry = await vocabularyRepository.findById(entryId);

  if (!entry) {
    await ctx.answerCallbackQuery({ text: t("noResults", lang) });
    return;
  }

  const text = t("dictionaryDeleteConfirm", lang, { word: entry.original });
  const kb = buildDeleteConfirmKeyboard(entryId, dict.currentPage, lang);

  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
  } catch (err) {
    logger.error({ err }, "Failed to edit dictionary message");
  }
  await ctx.answerCallbackQuery();
}

/* ── dict:confirm-delete:{entryId}:{page} ──────────────────────── */

export async function handleDictConfirmDelete(ctx: BotContext): Promise<void> {
  const dict = ctx.session.dictionary;
  if (!dict) { await answerExpired(ctx); return; }

  const data = ctx.callbackQuery?.data ?? "";
  const parts = data.split(":");
  const entryId = parseInt(parts[2] ?? "0", 10);
  const page = parseInt(parts[3] ?? "1", 10);

  const lang = await getUserLang(ctx);

  await vocabularyRepository.hardDelete(entryId);
  await ctx.answerCallbackQuery({ text: t("wordDeleted", lang) });

  // Re-count and re-fetch
  const total = await vocabularyRepository.countByUser(ctx.user.id);

  if (total === 0) {
    try {
      await ctx.editMessageText(t("emptyDictionary", lang), { reply_markup: undefined });
    } catch (err) {
      logger.error({ err }, "Failed to edit dictionary message");
    }
    ctx.session.dictionary = undefined;
    return;
  }

  const totalPages = Math.ceil(total / DICTIONARY_PAGE_SIZE);
  // If current page is now empty, go to previous page
  const safePage = page > totalPages ? totalPages : page;
  const offset = (safePage - 1) * DICTIONARY_PAGE_SIZE;
  const entries = await vocabularyRepository.findByUserPaginated(ctx.user.id, offset, DICTIONARY_PAGE_SIZE);

  const text = renderDictionaryList(entries, safePage, totalPages, total, lang);
  const kb = buildDictionaryListKeyboard(entries, safePage, totalPages, lang);

  try {
    await ctx.editMessageText(text, { parse_mode: "HTML", reply_markup: kb });
  } catch (err) {
    logger.error({ err }, "Failed to edit dictionary message");
  }

  dict.currentPage = safePage;
}

/* ── dict:close ────────────────────────────────────────────────── */

export async function handleDictClose(ctx: BotContext): Promise<void> {
  ctx.session.dictionary = undefined;
  try {
    await ctx.deleteMessage();
  } catch {
    /* message may already be deleted */
  }
  try {
    await ctx.answerCallbackQuery();
  } catch {
    /* ignore */
  }
}

/* ── dict:noop ─────────────────────────────────────────────────── */

export async function handleDictNoop(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
}
