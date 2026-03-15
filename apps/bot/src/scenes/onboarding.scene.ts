import { InlineKeyboard } from "grammy";
import type { Conversation } from "@grammyjs/conversations";
import { userRepository } from "@polyglot/adapter-db";
import { t, isSupported, type I18nKey, type SupportedLang } from "@polyglot/core";
import type { BotContext, ConversationContext } from "../types.js";
import { LANGUAGES, MAX_LEARNING_LANGS, langDisplay } from "../constants.js";
import { logger } from "@polyglot/infra";

type OnboardingConversation = Conversation<BotContext, ConversationContext>;

/**
 * 4-step onboarding conversation.
 *
 * Step 1: Choose interface language
 * Step 2: Choose native language
 * Step 3: Choose learning languages (multi-select, 1–4)
 * Step 4: Demo translation — user enters a word, sees placeholder result
 */
export async function onboarding(
  conversation: OnboardingConversation,
  ctx: ConversationContext,
): Promise<void> {
  // ctx.user is not available inside conversations — middleware-injected
  // properties don't survive the conversation replay mechanism.
  // Resolve the user from the database using the Telegram ID instead.
  const telegramId = ctx.from!.id;
  const user = await conversation.external(async () => {
    return userRepository.findByTelegramId(telegramId);
  });

  if (!user) {
    logger.error({ telegramId }, "User not found in onboarding conversation");
    await ctx.reply("Something went wrong. Please try /start again.");
    return;
  }

  const userId = user.id;

  // ── Step 1: Interface language ──
  const interfaceLang = await stepChooseLanguage(
    conversation,
    ctx,
    "chooseInterfaceLang",
    "en", // default language for first prompt
  );

  await conversation.external(async () => {
    await userRepository.updateOnboardingStep(userId, 1);
  });

  // ── Step 2: Native language ──
  const nativeLang = await stepChooseLanguage(
    conversation,
    ctx,
    "chooseNativeLang",
    interfaceLang,
  );

  await conversation.external(async () => {
    await userRepository.updateOnboardingStep(userId, 2);
  });

  // ── Step 3: Learning languages (multi-select) ──
  const learningLangs = await stepChooseLearningLangs(
    conversation,
    ctx,
    interfaceLang,
    nativeLang,
  );

  await conversation.external(async () => {
    await userRepository.updateOnboardingStep(userId, 3);
  });

  // Save language settings
  await conversation.external(async () => {
    await userRepository.updateSettings(userId, {
      interfaceLang,
      nativeLang,
      learningLangs,
    });
  });

  // ── Step 4: Demo translation ──
  await stepDemoTranslation(conversation, ctx, interfaceLang);

  // Mark user as onboarded
  await conversation.external(async () => {
    await userRepository.markOnboarded(userId);
  });

  logger.info({ userId }, "User completed onboarding");
}

/**
 * Step: choose a single language from an inline keyboard.
 */
async function stepChooseLanguage(
  conversation: OnboardingConversation,
  ctx: ConversationContext,
  textKey: I18nKey,
  lang: SupportedLang,
): Promise<SupportedLang> {
  const keyboard = new InlineKeyboard();
  for (const l of LANGUAGES) {
    keyboard.text(`${l.flag} ${l.label}`, `lang:${l.code}`).row();
  }

  await ctx.reply(t(textKey, lang), { reply_markup: keyboard });

  const response = await conversation.waitForCallbackQuery(/^lang:/, {
    otherwise: async (ctx) => {
      await ctx.reply(t(textKey, lang));
    },
  });

  const selectedCode = response.callbackQuery.data.replace("lang:", "");
  await response.answerCallbackQuery();

  // Edit the message to show the selection
  await response.editMessageText(
    `${t(textKey, lang)}\n\n✅ ${langDisplay(selectedCode)}`,
  );

  // All LANGUAGES codes are valid SupportedLang — fallback to "en" for safety
  return isSupported(selectedCode) ? selectedCode : "en";
}

/**
 * Step 3: multi-select learning languages with inline keyboard.
 * Users can select 1–4 languages, then press Done.
 */
async function stepChooseLearningLangs(
  conversation: OnboardingConversation,
  ctx: ConversationContext,
  interfaceLang: SupportedLang,
  nativeLang: SupportedLang,
): Promise<string[]> {
  const selected: string[] = [];

  function buildKeyboard(): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    for (const l of LANGUAGES) {
      // Don't show native language as an option to learn
      if (l.code === nativeLang) continue;
      const isSelected = selected.includes(l.code);
      const prefix = isSelected ? "✅ " : "";
      keyboard
        .text(`${prefix}${l.flag} ${l.label}`, `learn:${l.code}`)
        .row();
    }
    if (selected.length > 0) {
      keyboard.text(t("done", interfaceLang), "learn:done").row();
    }
    return keyboard;
  }

  const promptText = t("chooseLearningLangs", interfaceLang);
  await ctx.reply(promptText, { reply_markup: buildKeyboard() });

  // Loop until user presses Done
  while (true) {
    const response = await conversation.waitForCallbackQuery(/^learn:/, {
      otherwise: async (ctx) => {
        await ctx.reply(t("chooseLearningLangs", interfaceLang));
      },
    });

    const data = response.callbackQuery.data.replace("learn:", "");

    if (data === "done") {
      if (selected.length === 0) {
        await response.answerCallbackQuery({
          text: t("selectAtLeastOne", interfaceLang),
          show_alert: true,
        });
        continue;
      }
      await response.answerCallbackQuery();
      // Edit message to show final selection
      const selectedDisplay = selected.map((c) => langDisplay(c)).join(", ");
      await response.editMessageText(`${promptText}\n\n✅ ${selectedDisplay}`);
      return selected;
    }

    // Toggle language selection
    const langCode = data;
    const idx = selected.indexOf(langCode);
    if (idx >= 0) {
      selected.splice(idx, 1);
      await response.answerCallbackQuery({
        text: t("langRemoved", interfaceLang, { lang: langDisplay(langCode) }),
      });
    } else if (selected.length >= MAX_LEARNING_LANGS) {
      await response.answerCallbackQuery({
        text: t("maxLangsReached", interfaceLang, { max: MAX_LEARNING_LANGS }),
        show_alert: true,
      });
      continue;
    } else {
      selected.push(langCode);
      await response.answerCallbackQuery({
        text: t("langAdded", interfaceLang, { lang: langDisplay(langCode) }),
      });
    }

    // Update the keyboard to reflect current selection
    await response.editMessageReplyMarkup({
      reply_markup: buildKeyboard(),
    });
  }
}

/**
 * Step 4: Demo translation.
 * User enters any word, bot shows a placeholder result,
 * asks "Save to dictionary?" → Yes / No.
 */
async function stepDemoTranslation(
  conversation: OnboardingConversation,
  ctx: ConversationContext,
  interfaceLang: SupportedLang,
): Promise<void> {
  await ctx.reply(t("enterWord", interfaceLang));

  // Wait for user to send a text message
  const wordCtx = await conversation.waitFor("message:text", {
    otherwise: async (ctx) => {
      await ctx.reply(t("enterWord", interfaceLang));
    },
  });

  const word = wordCtx.message.text;

  // Show placeholder translation result (AI not wired yet)
  const resultText = t("demoResult", interfaceLang, { word });
  const saveKeyboard = new InlineKeyboard()
    .text(t("yes", interfaceLang), "demo:save")
    .text(t("no", interfaceLang), "demo:skip");

  await wordCtx.reply(resultText, {
    reply_markup: saveKeyboard,
    parse_mode: "Markdown",
  });

  // Wait for save/skip decision
  const saveCtx = await conversation.waitForCallbackQuery(/^demo:/, {
    otherwise: async (ctx) => {
      await ctx.reply(resultText, {
        reply_markup: saveKeyboard,
        parse_mode: "Markdown",
      });
    },
  });

  const action = saveCtx.callbackQuery.data.replace("demo:", "");
  await saveCtx.answerCallbackQuery();

  if (action === "save") {
    // TODO: Save word to dictionary once word.repository is wired
    await saveCtx.editMessageText(t("onboardingComplete", interfaceLang));
  } else {
    await saveCtx.editMessageText(
      t("onboardingCompleteNoSave", interfaceLang),
    );
  }
}
