import { InlineKeyboard } from "grammy";
import type { Conversation } from "@grammyjs/conversations";
import { userRepository } from "@polyglot/adapter-db";
import { t, isSupported, type I18nKey, type SupportedLang } from "@polyglot/core";
import type { BotContext, ConversationContext } from "../types.js";
import { MAX_LEARNING_LANGS } from "../constants.js";
import { getSupportedLangs, getLangDisplay } from "@polyglot/adapter-db";
import { logger } from "@polyglot/infra";

type OnboardingConversation = Conversation<BotContext, ConversationContext>;

/** Sentinel value returned by step functions when the user presses Back. */
const BACK = "__back__" as const;
type BackAction = typeof BACK;

/**
 * 4-step onboarding conversation with back-navigation support.
 *
 * Step 1: Choose interface language
 * Step 2: Choose native language        (back → step 1)
 * Step 3: Choose learning languages     (back → step 2)
 * Step 4: Demo translation              (back → step 3)
 */
export async function onboarding(
  conversation: OnboardingConversation,
  ctx: ConversationContext,
): Promise<void> {
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
  let step = 1;
  let interfaceLang: SupportedLang = "en";
  let nativeLang: SupportedLang = "en";
  let learningLangs: string[] = [];

  while (step <= 4) {
    switch (step) {
      case 1: {
        const result = await stepChooseLanguage(
          conversation, ctx, "chooseInterfaceLang", "en", false,
        );
        // Step 1 has no back button — always moves forward
        interfaceLang = result as SupportedLang;
        await conversation.external(() =>
          userRepository.updateOnboardingStep(userId, 1),
        );
        step = 2;
        break;
      }
      case 2: {
        const result = await stepChooseLanguage(
          conversation, ctx, "chooseNativeLang", interfaceLang, true,
        );
        if (result === BACK) { step = 1; break; }
        nativeLang = result;
        await conversation.external(() =>
          userRepository.updateOnboardingStep(userId, 2),
        );
        step = 3;
        break;
      }
      case 3: {
        const result = await stepChooseLearningLangs(
          conversation, ctx, interfaceLang, nativeLang,
        );
        if (result === BACK) { step = 2; break; }
        learningLangs = result;
        await conversation.external(() =>
          userRepository.updateOnboardingStep(userId, 3),
        );
        await conversation.external(() =>
          userRepository.updateSettings(userId, {
            interfaceLang,
            nativeLang,
            learningLangs,
          }),
        );
        step = 4;
        break;
      }
      case 4: {
        const result = await stepDemoTranslation(
          conversation, ctx, interfaceLang,
        );
        if (result === BACK) { step = 3; break; }
        step = 5; // exit loop
        break;
      }
    }
  }

  await conversation.external(() => userRepository.markOnboarded(userId));

  // Activate translate mode and persist to DB so it survives restarts
  ctx.session.activeMode = "translate";
  await conversation.external(() =>
    userRepository.updateActiveMode(userId, "translate"),
  );
  logger.info({ userId }, "User completed onboarding");
}

/**
 * Step: choose a single language from an inline keyboard.
 * When showBack is true, a ⬅️ Back button is appended.
 */
async function stepChooseLanguage(
  conversation: OnboardingConversation,
  ctx: ConversationContext,
  textKey: I18nKey,
  lang: SupportedLang,
  showBack: boolean,
): Promise<SupportedLang | BackAction> {
  const keyboard = new InlineKeyboard();
  for (const l of getSupportedLangs()) {
    keyboard.text(getLangDisplay(l.code), `lang:${l.code}`).row();
  }
  if (showBack) {
    keyboard.text(`⬅️ ${t("back", lang)}`, "onb:back").row();
  }

  await ctx.reply(t(textKey, lang), { reply_markup: keyboard });

  const response = await conversation.waitForCallbackQuery(
    /^(lang:|onb:back)/,
    {
      otherwise: async (ctx) => {
        await ctx.reply(t(textKey, lang));
      },
    },
  );

  if (response.callbackQuery.data === "onb:back") {
    await response.answerCallbackQuery();
    return BACK;
  }

  const selectedCode = response.callbackQuery.data.replace("lang:", "");
  await response.answerCallbackQuery();

  await response.editMessageText(
    `${t(textKey, lang)}\n\n✅ ${getLangDisplay(selectedCode)}`,
  );

  return isSupported(selectedCode) ? selectedCode : "en";
}

/**
 * Step 3: multi-select learning languages with inline keyboard.
 * Users can select 1–4 languages, then press Done. Back returns to step 2.
 */
async function stepChooseLearningLangs(
  conversation: OnboardingConversation,
  ctx: ConversationContext,
  interfaceLang: SupportedLang,
  nativeLang: SupportedLang,
): Promise<string[] | BackAction> {
  const selected: string[] = [];

  function buildKeyboard(): InlineKeyboard {
    const keyboard = new InlineKeyboard();
    for (const l of getSupportedLangs()) {
      if (l.code === nativeLang) continue;
      const isSelected = selected.includes(l.code);
      const prefix = isSelected ? "✅ " : "";
      keyboard
        .text(`${prefix}${getLangDisplay(l.code)}`, `learn:${l.code}`)
        .row();
    }
    if (selected.length > 0) {
      keyboard.text(t("done", interfaceLang), "learn:done").row();
    }
    keyboard
      .text(`⬅️ ${t("back", interfaceLang)}`, "learn:back")
      .row();
    return keyboard;
  }

  const promptText = t("chooseLearningLangs", interfaceLang);
  await ctx.reply(promptText, { reply_markup: buildKeyboard() });

  while (true) {
    const response = await conversation.waitForCallbackQuery(/^learn:/, {
      otherwise: async (ctx) => {
        await ctx.reply(t("chooseLearningLangs", interfaceLang));
      },
    });

    const data = response.callbackQuery.data.replace("learn:", "");

    if (data === "back") {
      await response.answerCallbackQuery();
      return BACK;
    }

    if (data === "done") {
      if (selected.length === 0) {
        await response.answerCallbackQuery({
          text: t("selectAtLeastOne", interfaceLang),
          show_alert: true,
        });
        continue;
      }
      await response.answerCallbackQuery();
      const selectedDisplay = selected.map((c) => getLangDisplay(c)).join(", ");
      await response.editMessageText(`${promptText}\n\n✅ ${selectedDisplay}`);
      return selected;
    }

    // Toggle language selection
    const langCode = data;
    const idx = selected.indexOf(langCode);
    if (idx >= 0) {
      selected.splice(idx, 1);
      await response.answerCallbackQuery({
        text: t("langRemoved", interfaceLang, { lang: getLangDisplay(langCode) }),
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
        text: t("langAdded", interfaceLang, { lang: getLangDisplay(langCode) }),
      });
    }

    await response.editMessageReplyMarkup({
      reply_markup: buildKeyboard(),
    });
  }
}

/**
 * Step 4: Demo translation.
 * User enters any word, bot shows a placeholder result,
 * asks "Save to dictionary?" → Yes / No.
 * Back button returns to step 3 (learning languages).
 */
async function stepDemoTranslation(
  conversation: OnboardingConversation,
  ctx: ConversationContext,
  interfaceLang: SupportedLang,
): Promise<void | BackAction> {
  const backKeyboard = new InlineKeyboard()
    .text(`⬅️ ${t("back", interfaceLang)}`, "onb:back")
    .row();

  await ctx.reply(t("enterWord", interfaceLang), {
    reply_markup: backKeyboard,
  });

  // Wait for either a text message (word) or the back button
  let word: string;
  while (true) {
    const response = await conversation.waitUntil(
      (ctx) => !!ctx.message?.text || ctx.callbackQuery?.data === "onb:back",
      {
        otherwise: async (ctx) => {
          await ctx.reply(t("enterWord", interfaceLang), {
            reply_markup: backKeyboard,
          });
        },
      },
    );

    if (response.callbackQuery?.data === "onb:back") {
      await response.answerCallbackQuery();
      return BACK;
    }

    if (response.message?.text) {
      word = response.message.text;
      break;
    }
  }

  // Show placeholder translation result
  const resultText = t("demoResult", interfaceLang, { word });
  const saveKeyboard = new InlineKeyboard()
    .text(t("yes", interfaceLang), "demo:save")
    .text(t("no", interfaceLang), "demo:skip");

  await ctx.reply(resultText, {
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
    await saveCtx.editMessageText(t("onboardingComplete", interfaceLang));
  } else {
    await saveCtx.editMessageText(
      t("onboardingCompleteNoSave", interfaceLang),
    );
  }
}
