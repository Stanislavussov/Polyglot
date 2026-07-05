import type { Conversation } from "@grammyjs/conversations";
import { isSupported, logger, type SupportedLang, t } from "@polyglot/core";
import { InlineKeyboard } from "grammy";
import { setUserCommands } from "../commands/commands.js";
import { MAX_LEARNING_LANGS } from "../constants.js";
import type { BotContext, ConversationContext } from "../types.js";
import { cleanupTechnicalMessages, trackTechnicalMessage } from "../utils/message-cleanup.js";

type OnboardingConversation = Conversation<BotContext, ConversationContext>;

/** Sentinel value returned by step functions when the user presses Back. */
const BACK = "__back__" as const;
type BackAction = typeof BACK;

/**
 * Infer the interface language from native language or Telegram locale.
 * Falls back to "en" if neither is a supported UI language.
 */
function inferInterfaceLang(nativeLang: SupportedLang, telegramLocale?: string): SupportedLang {
  // Native language is always a SupportedLang, use it first
  if (isSupported(nativeLang)) return nativeLang;
  // Try Telegram locale (e.g. "ru", "en-US" → "en")
  if (telegramLocale) {
    const code = telegramLocale.split("-")[0].toLowerCase();
    if (isSupported(code)) return code as SupportedLang;
  }
  return "en";
}

/**
 * 3-step onboarding conversation with back-navigation support.
 *
 * Step 1: Choose native language
 * Step 2: Choose learning languages (1–4)  (back → step 1)
 * Step 3: Demo translation                 (back → step 2)
 *
 * Interface language is inferred from native language selection.
 */
export async function onboarding(conversation: OnboardingConversation, ctx: ConversationContext): Promise<void> {
  const telegramId = ctx.from!.id;
  const telegramLocale = ctx.from?.language_code;
  const user = await conversation.external(async () => {
    // Resolve via the channel identity (Fable T24/A1) — the user was linked by authMiddleware.
    const userId = await ctx.services.identityRepository.resolveUserId("telegram", String(telegramId));
    return userId !== null ? ctx.services.userRepository.findById(userId) : null;
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
        const result = await stepChooseNativeLang(conversation, ctx, interfaceLang);
        // Step 1 has no back — always moves forward
        nativeLang = result;
        interfaceLang = inferInterfaceLang(nativeLang, telegramLocale);
        await conversation.external(() => ctx.services.userRepository.updateOnboardingStep(userId, 1));
        step = 2;
        break;
      }
      case 2: {
        const result = await stepChooseLearningLangs(conversation, ctx, interfaceLang, nativeLang);
        if (result === BACK) {
          step = 1;
          break;
        }
        learningLangs = result;
        await conversation.external(() => ctx.services.userRepository.updateOnboardingStep(userId, 2));
        await conversation.external(() =>
          ctx.services.userRepository.updateSettings(userId, {
            interfaceLang,
            nativeLang,
            learningLangs,
            lastSourceLang: null, // Clear on re-onboard (Task 36)
          }),
        );
        step = 3;
        break;
      }
      case 3: {
        const result = await stepChooseProficiencyLevels(conversation, ctx, interfaceLang, learningLangs, userId);
        if (result === BACK) {
          step = 2;
          break;
        }
        step = 4;
        break;
      }
      case 4: {
        const result = await stepDemoTranslation(conversation, ctx, interfaceLang);
        if (result === BACK) {
          step = 3;
          break;
        }
        step = 5; // exit loop
        break;
      }
    }
  }

  await conversation.external(() => ctx.services.userRepository.markOnboarded(userId));

  // Clean up technical onboarding messages
  await cleanupTechnicalMessages(ctx);

  // Activate translate mode and persist to DB so it survives restarts
  ctx.session.activeMode = "translate";
  ctx.session.nextSourceLang = null; // Clear on re-onboard (Task 36)
  await conversation.external(() => ctx.services.userRepository.updateActiveMode(userId, "translate"));

  // Set user-specific bot commands in their chosen interface language
  const chatId = ctx.from!.id;
  await conversation.external(() => setUserCommands(ctx.api, chatId, interfaceLang, user.audienceGroup));

  logger.info({ userId }, "User completed onboarding");
}

/**
 * Step 1: Choose native language from an inline keyboard (no back button).
 */
async function stepChooseNativeLang(
  conversation: OnboardingConversation,
  ctx: ConversationContext,
  lang: SupportedLang,
): Promise<SupportedLang> {
  const keyboard = new InlineKeyboard();
  for (const l of ctx.services.languageCache.getSupportedLangs()) {
    keyboard.text(ctx.services.languageCache.getLangDisplay(l.code), `lang:${l.code}`).row();
  }

  const msg = await ctx.reply(t("chooseNativeLang", lang), { reply_markup: keyboard });
  trackTechnicalMessage(ctx, msg.message_id);

  const response = await conversation.waitUntil((ctx) => {
    const text = ctx.message?.text;
    if (text?.startsWith("/")) return false;
    return ctx.callbackQuery?.data?.startsWith("lang:") ?? false;
  });

  if (!response.callbackQuery?.data) {
    throw new Error("Unexpected missing callback query data in onboarding language selection");
  }
  const selectedCode = response.callbackQuery.data.replace("lang:", "");
  await response.answerCallbackQuery();

  await response.editMessageText(
    `${t("chooseNativeLang", lang)}\n\n✅ ${ctx.services.languageCache.getLangDisplay(selectedCode)}`,
  );

  return isSupported(selectedCode) ? selectedCode : "en";
}

/**
 * Step 2: Multi-select learning languages with inline keyboard.
 * Users can select 1–4 languages, then press Done. Back returns to step 1.
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
    for (const l of ctx.services.languageCache.getSupportedLangs()) {
      if (l.code === nativeLang) continue;
      const isSelected = selected.includes(l.code);
      const prefix = isSelected ? "✅ " : "";
      keyboard.text(`${prefix}${ctx.services.languageCache.getLangDisplay(l.code)}`, `learn:${l.code}`).row();
    }
    if (selected.length > 0) {
      keyboard.text(t("done", interfaceLang), "learn:done").row();
    }
    keyboard.text(`⬅️ ${t("back", interfaceLang)}`, "learn:back").row();
    return keyboard;
  }

  const promptText = t("chooseLearningLangs", interfaceLang);
  const msg = await ctx.reply(promptText, { reply_markup: buildKeyboard() });
  trackTechnicalMessage(ctx, msg.message_id);

  while (true) {
    const response = await conversation.waitUntil((ctx) => {
      const text = ctx.message?.text;
      if (text?.startsWith("/")) return false;
      return ctx.callbackQuery?.data?.startsWith("learn:") ?? false;
    });

    if (!response.callbackQuery?.data) {
      throw new Error("Unexpected missing callback query data in onboarding learning language selection");
    }
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
      const selectedDisplay = selected.map((c) => ctx.services.languageCache.getLangDisplay(c)).join(", ");
      await response.editMessageText(`${promptText}\n\n✅ ${selectedDisplay}`);
      return selected;
    }

    // Toggle language selection
    const langCode = data;
    const idx = selected.indexOf(langCode);
    if (idx >= 0) {
      selected.splice(idx, 1);
      await response.answerCallbackQuery({
        text: t("langRemoved", interfaceLang, { lang: ctx.services.languageCache.getLangDisplay(langCode) }),
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
        text: t("langAdded", interfaceLang, { lang: ctx.services.languageCache.getLangDisplay(langCode) }),
      });
    }

    await response.editMessageReplyMarkup({
      reply_markup: buildKeyboard(),
    });
  }
}

const PROFICIENCY_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

const LEVEL_LABELS: Record<string, string> = {
  A1: "A1 — Beginner",
  A2: "A2 — Elementary",
  B1: "B1 — Intermediate",
  B2: "B2 — Upper Intermediate",
  C1: "C1 — Advanced",
  C2: "C2 — Proficiency",
};

/**
 * Step 2.5: Choose proficiency level for each learning language.
 * Iterates through each selected learning language and asks for CEFR level.
 */
async function stepChooseProficiencyLevels(
  conversation: OnboardingConversation,
  ctx: ConversationContext,
  interfaceLang: SupportedLang,
  learningLangs: string[],
  userId: number,
): Promise<undefined | BackAction> {
  for (let i = 0; i < learningLangs.length; i++) {
    const langCode = learningLangs[i];
    const langName = ctx.services.languageCache.getLangDisplay(langCode);

    const keyboard = new InlineKeyboard();
    for (const level of PROFICIENCY_LEVELS) {
      keyboard.text(LEVEL_LABELS[level], `level:${langCode}:${level}`).row();
    }
    if (i === 0) {
      keyboard.text(`⬅️ ${t("back", interfaceLang)}`, "level:back").row();
    }

    const promptText = t("chooseProficiencyLevel", interfaceLang, { lang: langName });
    const msg = await ctx.reply(promptText, { reply_markup: keyboard });
    trackTechnicalMessage(ctx, msg.message_id);

    const response = await conversation.waitUntil((waitCtx) => {
      const text = waitCtx.message?.text;
      if (text?.startsWith("/")) return false;
      return waitCtx.callbackQuery?.data?.startsWith("level:") ?? false;
    });

    if (!response.callbackQuery?.data) {
      throw new Error("Unexpected missing callback query data in proficiency level selection");
    }

    const data = response.callbackQuery.data;
    if (data === "level:back") {
      await response.answerCallbackQuery();
      return BACK;
    }

    const parts = data.split(":");
    const selectedLevel = parts[2];
    await response.answerCallbackQuery();
    await response.editMessageText(`${promptText}\n\n✅ ${LEVEL_LABELS[selectedLevel] ?? selectedLevel}`);

    await conversation.external(() => ctx.services.userRepository.setLanguageLevel(userId, langCode, selectedLevel));
  }

  return undefined;
}

/**
 * Step 3: Demo translation.
 * User enters any word, bot shows the result immediately (no Save/Skip).
 * Back button returns to step 2 (learning languages).
 */
async function stepDemoTranslation(
  conversation: OnboardingConversation,
  ctx: ConversationContext,
  interfaceLang: SupportedLang,
): Promise<undefined | BackAction> {
  const backKeyboard = new InlineKeyboard().text(`⬅️ ${t("back", interfaceLang)}`, "onb:back").row();

  const enterMsg = await ctx.reply(t("enterWord", interfaceLang), {
    reply_markup: backKeyboard,
  });
  trackTechnicalMessage(ctx, enterMsg.message_id);

  // Wait for either a text message (word) or the back button
  let word: string;
  while (true) {
    const response = await conversation.waitUntil((ctx) => {
      const text = ctx.message?.text;
      if (text?.startsWith("/")) return false;
      return !!text || ctx.callbackQuery?.data === "onb:back";
    });

    if (response.callbackQuery?.data === "onb:back") {
      await response.answerCallbackQuery();
      return BACK;
    }

    if (response.message?.text) {
      word = response.message.text;
      break;
    }
  }

  // Show translation result immediately — no Save/Skip prompt
  const resultText = t("demoResult", interfaceLang, { word });
  const resultMsg = await ctx.reply(resultText, { parse_mode: "Markdown" });
  trackTechnicalMessage(ctx, resultMsg.message_id);

  // Show onboarding complete message
  const completeMsg = await ctx.reply(t("onboardingComplete", interfaceLang));
  trackTechnicalMessage(ctx, completeMsg.message_id);
}
