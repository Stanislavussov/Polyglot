/**
 * The four onboarding screens (Task 72).
 *
 * Screen 0 — hook copy + native language (1 tap, guessed from the Telegram locale)
 * Screen 1 — learning languages with the CEFR level folded in (2 taps per language)
 * Screen 2 — instant wow: a real card from a curated hook word, no typing needed
 * Screen 3 — instruction + tappable entry points into the existing features
 *
 * Screens 0–2 are edited in place whenever the update that triggered them was a
 * button tap, so the whole setup happens in a single message.
 *
 * Every screen records its entry (`users.onboarding_step` + the Prometheus
 * counter) so drop-off is measurable per screen — the old flow only ever recorded
 * steps 1 and 2, which made a CEFR-screen abandon indistinguishable from a demo
 * abandon.
 */
import { logger, t } from "@polyglot/core";
import type { InlineKeyboard } from "grammy";
import { setUserCommands } from "../commands/commands.js";
import { ONBOARDING_SCREENCAST_FILE_ID } from "../constants.js";
import { editMessageTextOrReply } from "../scenes/helpers/edit-message.helper.js";
import type { BotContext } from "../types.js";
import { cleanupTechnicalMessages, replyTechnical, trackTechnicalMessage } from "../utils/message-cleanup.js";
import { getHookWordsForLangs } from "./hook-cards.js";
import {
  buildDemoKeyboard,
  buildFinalKeyboard,
  buildLearningKeyboard,
  buildNativeKeyboard,
} from "./onboarding-keyboards.js";
import { guessNativeLangFromLocale, type OnboardingState } from "./onboarding-state.js";
import { ONBOARDING_STEPS, type OnboardingStep, recordOnboardingStep } from "./onboarding-steps.js";

/**
 * Send or edit-in-place, depending on whether the current update is a button tap.
 * Prompts are tracked as technical messages so they can be swept once the user
 * reaches the payoff.
 */
async function present(ctx: BotContext, text: string, keyboard: InlineKeyboard): Promise<void> {
  if (ctx.callbackQuery) {
    // A screen older than Telegram's 48-hour edit window cannot be edited, so the
    // helper sends a fresh message instead — and that message must be tracked too.
    // Onboarding is explicitly designed to survive multi-day pauses, so this is a
    // path real users take; leaving the replacement untracked would strand a
    // dead-looking setup screen in the chat forever after completion.
    const replacement = await editMessageTextOrReply(ctx, text, { reply_markup: keyboard });
    if (replacement) trackTechnicalMessage(ctx, replacement.message_id);
    return;
  }
  await replyTechnical(ctx, text, { reply_markup: keyboard });
}

/** Screen 0 — the promise, then the native language in one tap. */
export async function showNativeScreen(ctx: BotContext, state: OnboardingState): Promise<void> {
  const lang = state.interfaceLang;
  const text = `${t("onbIntro", lang)}\n\n${t("onbNativePrompt", lang)}`;

  await enterStep(ctx, state, ONBOARDING_STEPS.native);
  await present(ctx, text, buildNativeKeyboard(ctx, lang, guessNativeLangFromLocale(ctx)));
}

/**
 * Screen 1 — learning languages. `expandedLang` opens that language's compact
 * CEFR row inside the same message; null shows the plain two-column list.
 */
export async function showLanguagesScreen(
  ctx: BotContext,
  state: OnboardingState,
  expandedLang: string | null,
): Promise<void> {
  const lang = state.interfaceLang;
  const parts = [t("chooseLearningLangs", lang)];

  if (state.learningLangs.length > 0) {
    const chips = state.learningLangs
      .map((code) => `✅ ${ctx.services.languageCache.getLangDisplay(code)} · ${state.levels[code]}`)
      .join("\n");
    parts.push(chips);
    // The moment the first language is confirmed, preview the payoff.
    parts.push(t("onbPayoffPreview", lang));
  }

  if (expandedLang) {
    parts.push(
      t("onbLevelPrompt", lang, { lang: ctx.services.languageCache.getLangDisplay(expandedLang) }),
      t("onbLevelLegend", lang),
    );
  }

  await enterStep(ctx, state, ONBOARDING_STEPS.languages);
  await present(ctx, parts.join("\n\n"), buildLearningKeyboard(ctx, state, expandedLang));
}

/** Screen 2 — the payoff: tap a curated word, get a real card. Typing is optional. */
export async function showDemoScreen(ctx: BotContext, state: OnboardingState): Promise<void> {
  const lang = state.interfaceLang;
  const hooks = getHookWordsForLangs(state.learningLangs);
  const text = `${t("onbDemoPrompt", lang)}\n\n${t("onbDemoOrType", lang)}`;

  await enterStep(ctx, state, ONBOARDING_STEPS.demo);

  if (hooks.length === 0) {
    // No curated words for this language set — the typed path is still a full
    // demo, so the screen degrades to an invitation rather than an empty wall.
    await present(ctx, t("onbDemoOrType", lang), buildDemoKeyboard(ctx, state));
    return;
  }

  await present(ctx, text, buildDemoKeyboard(ctx, state));
}

/**
 * Screen 3 — instruction + feature entry points, and the point at which the user
 * is marked onboarded. Called once, immediately after the first card is shown.
 */
export async function showFinalScreen(ctx: BotContext, state: OnboardingState): Promise<void> {
  const lang = state.interfaceLang;

  // The setup prompts have served their purpose; the card the user just got stays.
  await cleanupTechnicalMessages(ctx);

  await sendScreencast(ctx);

  await ctx.reply(`${t("onbDemoMore", lang)}\n\n${t("onboardingComplete", lang)}`, {
    reply_markup: buildFinalKeyboard(lang),
  });

  await ctx.services.userRepository.markOnboarded(state.userId);
  recordOnboardingStep(ONBOARDING_STEPS.complete, "completed");

  // Translate mode is the resting state. The DB is the source of truth — the
  // session write is a best-effort fast path and is guarded because a context
  // rebuilt outside the session middleware can carry no session at all.
  if (ctx.session) {
    ctx.session.activeMode = "translate";
    ctx.session.nextSourceLang = null;
  }
  await ctx.services.userRepository.updateActiveMode(state.userId, "translate");

  const chatId = ctx.from?.id;
  if (chatId && ctx.user) {
    await setUserCommands(ctx.api, chatId, lang, ctx.user.audienceGroup);
  }

  logger.info({ userId: state.userId, learningLangs: state.learningLangs }, "User completed onboarding");
}

/**
 * Optional screencast above the instruction screen. Absent asset → nothing is
 * sent and nothing is logged as a failure; a send error (e.g. a stale file_id)
 * is swallowed so it can never block completion.
 */
async function sendScreencast(ctx: BotContext): Promise<void> {
  if (!ONBOARDING_SCREENCAST_FILE_ID) return;
  try {
    await ctx.replyWithAnimation(ONBOARDING_SCREENCAST_FILE_ID);
  } catch (err) {
    logger.warn({ err }, "Onboarding screencast could not be sent — continuing without it");
  }
}

/**
 * Record entry to a screen: persist the furthest step reached and increment the
 * bounded Prometheus counter. The persisted step only ever moves forward, so
 * re-rendering an earlier screen (e.g. re-opening the native picker) cannot
 * rewind the funnel — while the counter records every entry, including repeats.
 */
async function enterStep(ctx: BotContext, state: OnboardingState, step: OnboardingStep): Promise<void> {
  recordOnboardingStep(step, "entered");
  if (step > state.persistedStep) {
    await ctx.services.userRepository.updateOnboardingStep(state.userId, step);
    state.persistedStep = step;
  }
}
