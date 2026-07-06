import type { Conversation } from "@grammyjs/conversations";
import { type IssueType, logger, type SupportedLang, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import type { BotContext, ConversationContext } from "../types.js";
import { cleanupTechnicalMessages, trackTechnicalMessage } from "../utils/message-cleanup.js";
import { editMessageTextOrReply } from "./helpers/edit-message.helper.js";

const BACK = Symbol("back");
type BackAction = typeof BACK;

type ReportConversation = Conversation<BotContext, ConversationContext>;

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

  const titleMsg = await ctx.reply(t("reportTitle", lang));
  trackTechnicalMessage(ctx, titleMsg.message_id);
  const typeMsg = await ctx.reply(t("reportChooseType", lang), { reply_markup: keyboard });
  trackTechnicalMessage(ctx, typeMsg.message_id);

  // `next: true` on every wait: an update the predicate rejects must fall
  // through to downstream middleware (exitActiveConversations, mode-router)
  // instead of being dropped by the conversations engine. Without it an
  // abandoned dialog silently eats every message AND command in the chat
  // until the next bot restart (2026-07-06 prod incident).
  const response = await conversation.waitUntil(
    (ctx) => {
      const text = ctx.message?.text;
      if (text?.startsWith("/")) return false;
      return ctx.callbackQuery?.data?.startsWith("report:type:") ?? false;
    },
    { next: true },
  );

  if (!response.callbackQuery?.data) {
    throw new Error("Unexpected missing callback query data in report type selection");
  }
  const type = response.callbackQuery.data.replace("report:type:", "") as IssueType;
  await response.answerCallbackQuery();
  await editMessageTextOrReply(response, `${t("reportTitle", lang)}\n\n✅ ${typeToLabel(type, lang)}`);
  return type;
}

async function stepEnterDescription(
  conversation: ReportConversation,
  ctx: ConversationContext,
  lang: SupportedLang,
): Promise<string | BackAction> {
  const backKeyboard = new InlineKeyboard().text(`⬅️ ${t("back", lang)}`, "report:back");

  const descMsg = await ctx.reply(t("reportEnterDescription", lang), { reply_markup: backKeyboard });
  trackTechnicalMessage(ctx, descMsg.message_id);

  while (true) {
    const response = await conversation.waitUntil(
      (ctx) => {
        const text = ctx.message?.text;
        if (text?.startsWith("/")) return false;
        return !!text || ctx.callbackQuery?.data === "report:back";
      },
      { next: true },
    );

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

  const previewMsg = await ctx.reply(preview, { parse_mode: "HTML", reply_markup: keyboard });
  trackTechnicalMessage(ctx, previewMsg.message_id);

  const response = await conversation.waitUntil(
    (ctx) => {
      const text = ctx.message?.text;
      if (text?.startsWith("/")) return false;
      return ["report:send", "report:edit", "report:cancel"].includes(ctx.callbackQuery?.data ?? "");
    },
    { next: true },
  );

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
  // Read through conversation.external so it runs once against the live context
  // rather than re-executing on every conversation replay.
  const settings = await conversation.external(() => ctx.services.userRepository.getSettings(userId));
  const lang: SupportedLang = (settings?.interfaceLang ?? "en") as SupportedLang;

  const type = await stepChooseType(conversation, ctx, lang);

  let description: string;
  let action: "send" | "edit" | "cancel";

  do {
    const descriptionOrBack = await stepEnterDescription(conversation, ctx, lang);
    if (descriptionOrBack === BACK) {
      await cleanupTechnicalMessages(ctx);
      await ctx.reply(t("reportCancelled", lang));
      return;
    }
    description = descriptionOrBack;
    action = await stepPreview(conversation, ctx, lang, type, description);
  } while (action === "edit");

  if (action === "cancel") {
    await cleanupTechnicalMessages(ctx);
    await ctx.reply(t("reportCancelled", lang));
    return;
  }

  // action === "send"
  await cleanupTechnicalMessages(ctx);
  await conversation.external(async () => {
    await ctx.services.reportedIssueRepository.create(userId, type, description);
  });
  await ctx.reply(t("reportSent", lang));
  logger.info({ userId, type }, "User submitted a report");
}
