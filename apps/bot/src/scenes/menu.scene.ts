/**
 * `/menu` — the category menu, and the only screen that is not a hot button.
 *
 * The reply keyboard carries the three things a learner reaches for constantly (deck,
 * mentor, dictionary). Everything rarer is here, one level down and grouped: the rest of
 * the practice modes, the settings, the bug report.
 *
 * Navigation inside the menu edits the same message rather than sending a new one — a
 * chat that accumulates one dead menu per tap buries the cards the user came for, and an
 * older menu keeps showing values that have since changed. Handing off to a *feature*
 * (the deck, the dictionary page, the report dialog) is the opposite: that is content,
 * not navigation, so the menu message is removed and the feature answers fresh.
 */

import { isSupported, logEvent, type SupportedLang, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import type { BotContext } from "../types.js";
import { handleDictionaryCommand } from "./dictionary.scene.js";
import { dismissMenuMessage, editMessageTextOrReply } from "./helpers/edit-message.helper.js";
import { buildLearnKeyboard } from "./learn.scene.js";
import { renderSettingsInPlace } from "./settings.scene.js";

export const MENU_CALLBACK_PATTERN = /^menu:/;

export function buildMenuKeyboard(lang: SupportedLang): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text(`📖 ${t("menuBtnDictionary", lang)}`, "menu:dict").row();
  kb.text(`🎓 ${t("menuBtnLearn", lang)}`, "menu:learn").row();
  kb.text(`⚙️ ${t("menuBtnSettings", lang)}`, "menu:settings").row();
  kb.text(`🐛 ${t("menuBtnReport", lang)}`, "menu:report").row();
  kb.text(t("menuClose", lang), "menu:close").row();
  return kb;
}

async function resolveLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  return isSupported(iLang) ? iLang : "en";
}

/** `/menu` — opens the menu as its own message; there is nothing to edit in place. */
export async function handleMenuCommand(ctx: BotContext): Promise<void> {
  const lang = await resolveLang(ctx);
  logEvent("menu.opened", { via: "command" });
  await ctx.reply(t("menuHubTitle", lang), { reply_markup: buildMenuKeyboard(lang) });
}

export async function handleMenuCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data ?? "";
  const lang = await resolveLang(ctx);

  switch (data) {
    case "menu:root":
      await ctx.answerCallbackQuery();
      await editMessageTextOrReply(ctx, t("menuHubTitle", lang), { reply_markup: buildMenuKeyboard(lang) });
      return;

    case "menu:learn":
      await ctx.answerCallbackQuery();
      logEvent("menu.hub_opened", { hub: "learn" });
      await editMessageTextOrReply(ctx, t("learnHubTitle", lang), { reply_markup: buildLearnKeyboard(lang) });
      return;

    case "menu:settings":
      await ctx.answerCallbackQuery();
      await renderSettingsInPlace(ctx);
      return;

    case "menu:dict":
      await handOff(ctx);
      await handleDictionaryCommand(ctx);
      return;

    case "menu:report":
      await handOff(ctx);
      await ctx.conversation.enter("handleReportIssue");
      return;

    case "menu:close":
      await handOff(ctx);
      return;

    default:
      await ctx.answerCallbackQuery();
      return;
  }
}

/** Clears the menu away before a feature answers with a screen of its own. */
async function handOff(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  await dismissMenuMessage(ctx);
}
