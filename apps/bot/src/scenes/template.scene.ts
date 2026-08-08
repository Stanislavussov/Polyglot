/**
 * Template constructor wizard — /template command handler.
 * Callback handlers are in helpers/template.helper.ts.
 */
import { isSupported, resolveTemplate, type SupportedLang, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import type { BotContext } from "../types.js";
import { replyTechnical } from "../utils/message-cleanup.js";

/** /template command handler */
export async function handleTemplateCommand(ctx: BotContext): Promise<void> {
  ctx.session.needsTranslateReminder = true;
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  const saved = await ctx.services.translationTemplateRepository.getByUserId(ctx.user.id);
  const tpl = resolveTemplate(saved ? { name: saved.name, fields: saved.fields } : null);

  const lines: string[] = [
    t("templateTitle", lang),
    t("templateCurrent", lang, { name: tpl.name }),
    "",
    saved ? t("templateCustom", lang) : t("templateDefault", lang),
  ];

  const kb = new InlineKeyboard();
  kb.text(t("templateCustomize", lang), "tpl:customize");
  kb.text(t("templateReset", lang), "tpl:reset");

  await replyTechnical(ctx, lines.join("\n"), { reply_markup: kb, parse_mode: "HTML" });
}
