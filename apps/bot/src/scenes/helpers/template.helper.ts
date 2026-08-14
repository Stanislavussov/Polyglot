/**
 * Template wizard callback handlers — tpl:* callbacks.
 * Manages customize, toggle, preview, save, cancel, reset flows.
 */
import {
  type I18nKey,
  isSupported,
  resolveTemplate,
  type SupportedLang,
  TEMPLATE_FIELD_KEYS,
  type TemplateFields,
  t,
} from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { renderTranslation } from "../../renderers/translation.renderer.js";
import type { BotContext } from "../../types.js";
import { resolveLanguageOrder } from "../../utils/language-order.js";
import { cleanupTechnicalMessages, replyTechnical } from "../../utils/message-cleanup.js";
import { MOCK_PREVIEW_OUTPUT } from "../template-preview.data.js";
import { editMessageTextOrReply } from "./edit-message.helper.js";

/** Map TemplateFields key → i18n key for field label */
const FIELD_I18N_MAP: Record<keyof TemplateFields, I18nKey> = {
  synonyms: "templateFieldSynonyms",
  examples: "templateFieldExamples",
  alternatives: "templateFieldAlternatives",
  equivalentNote: "templateFieldEquivalentNote",
  connotationWarning: "templateFieldConnotationWarning",
  grammarBreakdown: "templateFieldGrammarBreakdown",
};

/** Resolve interface language from user settings */
async function getLang(ctx: BotContext): Promise<SupportedLang> {
  const settings = await ctx.services.userRepository.getSettings(ctx.user.id);
  const iLang = settings?.interfaceLang ?? "en";
  return (isSupported(iLang) ? iLang : "en") as SupportedLang;
}

/** Build the toggle keyboard for the constructor */
function buildToggleKeyboard(fields: TemplateFields, lang: SupportedLang): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const key of TEMPLATE_FIELD_KEYS) {
    const icon = fields[key] ? "✅" : "❌";
    const label = t(FIELD_I18N_MAP[key], lang);
    kb.text(`${icon} ${label}`, `tpl:toggle:${key}`).row();
  }
  kb.text(t("templatePreview", lang), "tpl:preview");
  kb.text(t("templateSave", lang), "tpl:save");
  kb.text(t("templateCancel", lang), "tpl:cancel");
  return kb;
}

/** tpl:customize — enter the constructor */
export async function handleCustomizeCallback(ctx: BotContext): Promise<void> {
  const lang = await getLang(ctx);
  const saved = await ctx.services.translationTemplateRepository.getByUserId(ctx.user.id);
  const tpl = resolveTemplate(saved ? { name: saved.name, fields: saved.fields } : null);

  ctx.session.templateWizard = { fields: { ...tpl.fields } };
  const kb = buildToggleKeyboard(ctx.session.templateWizard.fields, lang);
  const text = t("templateConstructor", lang);

  try {
    await editMessageTextOrReply(ctx, text, { reply_markup: kb, parse_mode: "HTML" });
    ctx.session.templateWizard.wizardMsgId = ctx.callbackQuery?.message?.message_id;
  } catch {
    const msg = await replyTechnical(ctx, text, { reply_markup: kb, parse_mode: "HTML" });
    ctx.session.templateWizard.wizardMsgId = msg.message_id;
  }
  await ctx.answerCallbackQuery();
}

/** tpl:toggle:<key> — toggle a field */
export async function handleToggleCallback(ctx: BotContext): Promise<void> {
  if (!ctx.session.templateWizard) {
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery({
      text: t("templateSessionExpired", lang),
      show_alert: true,
    });
    return;
  }
  const data = ctx.callbackQuery?.data ?? "";
  const key = data.replace("tpl:toggle:", "") as keyof TemplateFields;
  if (!TEMPLATE_FIELD_KEYS.includes(key)) {
    await ctx.answerCallbackQuery();
    return;
  }
  ctx.session.templateWizard.fields[key] = !ctx.session.templateWizard.fields[key];
  const lang = await getLang(ctx);
  const kb = buildToggleKeyboard(ctx.session.templateWizard.fields, lang);
  await editMessageTextOrReply(ctx, t("templateConstructor", lang), {
    reply_markup: kb,
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
}

/** tpl:preview — show sample card with current fields */
export async function handlePreviewCallback(ctx: BotContext): Promise<void> {
  if (!ctx.session.templateWizard) {
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery({
      text: t("templateSessionExpired", lang),
      show_alert: true,
    });
    return;
  }
  const lang = await getLang(ctx);
  // Preview the mock card in the user's own language order, so the wizard shows
  // what their real cards will look like.
  const card = renderTranslation(
    MOCK_PREVIEW_OUTPUT,
    await resolveLanguageOrder(ctx),
    lang,
    ctx.session.templateWizard.fields,
  );
  const text = `${t("templatePreviewHeader", lang)}\n\n${card}`;
  const kb = new InlineKeyboard().text(t("templateBack", lang), "tpl:back");
  await editMessageTextOrReply(ctx, text, { reply_markup: kb, parse_mode: "HTML" });
  await ctx.answerCallbackQuery();
}

/** tpl:back — return from preview to constructor */
export async function handleBackCallback(ctx: BotContext): Promise<void> {
  if (!ctx.session.templateWizard) {
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery({
      text: t("templateSessionExpired", lang),
      show_alert: true,
    });
    return;
  }
  const lang = await getLang(ctx);
  const kb = buildToggleKeyboard(ctx.session.templateWizard.fields, lang);
  await editMessageTextOrReply(ctx, t("templateConstructor", lang), {
    reply_markup: kb,
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
}

/** tpl:save — persist the template */
export async function handleSaveTemplateCallback(ctx: BotContext): Promise<void> {
  if (!ctx.session.templateWizard) {
    const lang = await getLang(ctx);
    await ctx.answerCallbackQuery({
      text: t("templateSessionExpired", lang),
      show_alert: true,
    });
    return;
  }
  const lang = await getLang(ctx);
  await ctx.services.translationTemplateRepository.upsert(ctx.user.id, "Custom", ctx.session.templateWizard.fields);
  ctx.session.templateWizard = undefined;
  await cleanupTechnicalMessages(ctx);
  await editMessageTextOrReply(ctx, t("templateSaved", lang), {
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
}

/** tpl:cancel — discard changes */
export async function handleCancelCallback(ctx: BotContext): Promise<void> {
  ctx.session.templateWizard = undefined;
  const lang = await getLang(ctx);
  await cleanupTechnicalMessages(ctx);
  await editMessageTextOrReply(ctx, t("templateCancelled", lang), {
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
}

/** tpl:reset — delete custom template */
export async function handleResetCallback(ctx: BotContext): Promise<void> {
  const lang = await getLang(ctx);
  await ctx.services.translationTemplateRepository.deleteByUserId(ctx.user.id);
  ctx.session.templateWizard = undefined;
  await cleanupTechnicalMessages(ctx);
  await editMessageTextOrReply(ctx, t("templateResetDone", lang), {
    parse_mode: "HTML",
  });
  await ctx.answerCallbackQuery();
}
