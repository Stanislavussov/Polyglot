import type { Conversation } from "@grammyjs/conversations";
import { type IssueType, reportedIssueRepository, userRepository } from "@polyglot/adapter-db";
import { logger, type SupportedLang, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import type { BotContext, ConversationContext } from "../types.js";

type ReportConversation = Conversation<BotContext, ConversationContext>;

const BACK = Symbol("back");
type BackAction = typeof BACK;

const MAX_DESCRIPTION_LENGTH = 1000;

function typeToLabel(type: IssueType, lang: SupportedLang): string {
  if (type === "bug") return t("reportBug", lang);
  if (type === "suggestion") return t("reportSuggestion", lang);
  return t("reportOther", lang);
}

async function stepChooseType(
  conversation: ReportConversation,
  ctx: ConversationContext,
  lang: SupportedLang,
): Promise<IssueType> {
  const keyboard = new InlineKeyboard()
    .text(t("reportBug", lang), "report:type:bug")
    .row()
    .text(t("reportSuggestion", lang), "report:type:suggestion")
    .row()
    .text(t("reportOther", lang), "report:type:other");

  await ctx.reply(t("reportTitle", lang));
  await ctx.reply(t("reportChooseType", lang), { reply_markup: keyboard });

  const response = await conversation.waitUntil((ctx) => {
    const text = ctx.message?.text;
    if (text?.startsWith("/")) return false;
    return ctx.callbackQuery?.data?.startsWith("report:type:") ?? false;
  });

  if (!response.callbackQuery?.data) {
    throw new Error("Unexpected missing callback query data in report type selection");
  }
  const type = response.callbackQuery.data.replace("report:type:", "") as IssueType;
  await response.answerCallbackQuery();
  await response.editMessageText(`${t("reportTitle", lang)}\n\n✅ ${typeToLabel(type, lang)}`);
  return type;
}

async function stepEnterDescription(
  conversation: ReportConversation,
  ctx: ConversationContext,
  lang: SupportedLang,
): Promise<string | BackAction> {
  const backKeyboard = new InlineKeyboard().text(`⬅️ ${t("back", lang)}`, "report:back");

  await ctx.reply(t("reportEnterDescription", lang), { reply_markup: backKeyboard });

  while (true) {
    const response = await conversation.waitUntil((ctx) => {
      const text = ctx.message?.text;
      if (text?.startsWith("/")) return false;
      return !!text || ctx.callbackQuery?.data === "report:back";
    });

    if (response.callbackQuery?.data === "report:back") {
      await response.answerCallbackQuery();
      return BACK;
    }

    if (response.message?.text) {
      const text = response.message.text.trim();

      if (text.length > MAX_DESCRIPTION_LENGTH) {
        await ctx.reply(t("reportTooLong", lang));
        continue;
      }

      return text;
    }
  }
}

async function stepPreview(
  conversation: ReportConversation,
  ctx: ConversationContext,
  lang: SupportedLang,
  type: IssueType,
  description: string,
): Promise<"send" | "edit" | "cancel"> {
  const typeLabel = typeToLabel(type, lang);
  const preview = `${t("reportPreview", lang)}\n\n<b>${typeLabel}</b>\n${description}`;
  const keyboard = new InlineKeyboard()
    .text(t("reportSend", lang), "report:send")
    .row()
    .text(t("reportEdit", lang), "report:edit")
    .row()
    .text(t("reportCancel", lang), "report:cancel");

  await ctx.reply(preview, { parse_mode: "HTML", reply_markup: keyboard });

  const response = await conversation.waitUntil((ctx) => {
    const text = ctx.message?.text;
    if (text?.startsWith("/")) return false;
    return ["report:send", "report:edit", "report:cancel"].includes(ctx.callbackQuery?.data ?? "");
  });

  if (!response.callbackQuery?.data) {
    throw new Error("Unexpected missing callback query data in report preview");
  }
  const action = response.callbackQuery.data.replace("report:", "");
  await response.answerCallbackQuery();
  return action as "send" | "edit" | "cancel";
}

/**
 * Multi-step report issue conversation.
 *
 * Step 1: Choose type (bug / suggestion / other)
 * Step 2: Enter description
 * Step 3: Preview with Send / Edit / Cancel
 *   → Send: persists to DB, shows confirmation
 *   → Edit: back to step 2
 *   → Cancel: exit
 */
export async function handleReportIssue(conversation: ReportConversation, ctx: ConversationContext): Promise<void> {
  if (!ctx.user) {
    await ctx.reply("Please use /start first.");
    return;
  }
  const userId = ctx.user.id;
  const settings = await userRepository.getSettings(userId);
  const lang: SupportedLang = (settings?.interfaceLang ?? "en") as SupportedLang;

  const type = await stepChooseType(conversation, ctx, lang);

  let description: string;
  let action: "send" | "edit" | "cancel";

  do {
    const descriptionOrBack = await stepEnterDescription(conversation, ctx, lang);
    if (descriptionOrBack === BACK) {
      await ctx.reply(t("reportCancelled", lang));
      return;
    }
    description = descriptionOrBack;
    action = await stepPreview(conversation, ctx, lang, type, description);
  } while (action === "edit");

  if (action === "cancel") {
    await ctx.reply(t("reportCancelled", lang));
    return;
  }

  // action === "send"
  await conversation.external(async () => {
    await reportedIssueRepository.create(userId, type, description);
  });
  await ctx.reply(t("reportSent", lang));
  logger.info({ userId, type }, "User submitted a report");
}
