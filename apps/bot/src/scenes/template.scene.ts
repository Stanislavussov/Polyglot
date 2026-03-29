/**
 * Template constructor wizard — /template command handler.
 * Callback handlers are in helpers/template.helper.ts.
 */
import { translationTemplateRepository, userRepository } from "@polyglot/adapter-db";
import { isSupported, resolveTemplate, type SupportedLang, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import type { BotContext } from "../types.js";

/** /template command handler */
export async function handleTemplateCommand(ctx: BotContext): Promise<void> {
  ctx.session.needsTranslateReminder = true;
  const settings = await userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  const lang = (isSupported(iLang) ? iLang : "en") as SupportedLang;

  const saved = await translationTemplateRepository.getByUserId(ctx.user.id);
  const tpl = resolveTemplate(saved ? { name: saved.name, fields: saved.fields } : null);

  const lines: string[] = [
    t("templateTitle" as any, lang),
    t("templateCurrent" as any, lang, { name: tpl.name }),
    "",
    saved ? t("templateCustom" as any, lang) : t("templateDefault" as any, lang),
  ];

  const kb = new InlineKeyboard();
  kb.text(t("templateCustomize" as any, lang), "tpl:customize");
  kb.text(t("templateReset" as any, lang), "tpl:reset");

  await ctx.reply(lines.join("\n"), { reply_markup: kb, parse_mode: "HTML" });
}
