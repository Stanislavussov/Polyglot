/**
 * Stateless onboarding handlers (Task 72, slice 7).
 *
 * These replace the grammY conversation the flow used to live in. A conversation
 * brought three production failure modes with it — a 10-minute wait timeout that
 * left every button dead, an abandoned dialog that swallowed all subsequent
 * messages, and a replayed context whose `ctx.session` could be undefined. None
 * of them can occur here: each tap is an ordinary callback handler that re-reads
 * its state from the database, so a pause of any length is invisible and an
 * unrecognised update simply falls through to the rest of the middleware chain.
 */
import { errorFields, logEvent, t } from "@polyglot/core";
import type { NextFunction } from "grammy";
import { MAX_LEARNING_LANGS } from "../constants.js";
import { handleDictionaryCommand } from "../scenes/dictionary.scene.js";
import { handleTranslateText } from "../scenes/helpers/translate-flow.js";
import { handleVideosCommand } from "../scenes/helpers/video-vocabulary.helper.js";
import { handleSettingsCommand } from "../scenes/settings.scene.js";
import { handleReviewCommand } from "../scenes/srs.scene.js";
import type { BotContext } from "../types.js";
import { cacheDemoCard, resolveHookWord, sendCachedDemoCard } from "./hook-cards.js";
import {
  isOnboardingFeature,
  LEVEL_REMOVE,
  LEVEL_UNKNOWN,
  ONB,
  type OnboardingFeature,
} from "./onboarding-keyboards.js";
import { showDemoScreen, showFinalScreen, showLanguagesScreen, showNativeScreen } from "./onboarding-screens.js";
import {
  DEFAULT_PROFICIENCY_LEVEL,
  inferInterfaceLang,
  isProficiencyLevel,
  loadOnboardingState,
  type OnboardingState,
} from "./onboarding-state.js";
import { ONBOARDING_STEPS, recordOnboardingStep } from "./onboarding-steps.js";

/** Every callback this module owns. Registered as one group in the bot factory. */
export const ONBOARDING_CALLBACK_PATTERN = /^onb:/;

/**
 * The callback prefixes emitted by the **previous**, conversation-based
 * onboarding. A user who is mid-flow when this version deploys still has one of
 * those keyboards on screen, and its buttons are now produced by nothing. Left
 * unhandled they would match no route at all: the callback query is never
 * answered, so the button spins and clears with no reply — which is precisely the
 * 2026-08-01 "bot stopped responding to language selection" incident, recreated
 * by the very change that was supposed to end it.
 */
export const LEGACY_ONBOARDING_CALLBACK_PATTERN = /^(?:lang|learn|level):/;

const FEATURE_HANDLERS: Record<OnboardingFeature, (ctx: BotContext) => Promise<void>> = {
  dictionary: handleDictionaryCommand,
  training: handleReviewCommand,
  video: handleVideosCommand,
  settings: handleSettingsCommand,
};

/**
 * Entry point from `/start` for a user who has not finished onboarding. Resumes
 * on the furthest screen already reached rather than restarting from screen 0 —
 * a user who already picked three languages is never asked for their native
 * language again.
 */
export async function startOnboarding(ctx: BotContext): Promise<void> {
  const state = await loadOnboardingState(ctx);
  if (!state) {
    logEvent("onboarding.start_without_user", {}, "error");
    return;
  }
  logEvent("onboarding.started", { step: state.step, telegramLocale: ctx.from?.language_code });
  await renderCurrentScreen(ctx, state);
}

/** Render whichever screen the persisted state says the user is on. */
async function renderCurrentScreen(ctx: BotContext, state: OnboardingState): Promise<void> {
  logEvent("onboarding.screen_rendered", { step: state.step, learningLangs: state.learningLangs });
  switch (state.step) {
    case ONBOARDING_STEPS.native:
      await showNativeScreen(ctx, state);
      return;
    case ONBOARDING_STEPS.languages:
      await showLanguagesScreen(ctx, state, null);
      return;
    default:
      await showDemoScreen(ctx, state);
  }
}

/** All `onb:*` taps. */
export async function handleOnboardingCallback(ctx: BotContext): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  // The final screen's feature buttons are tapped by an already-onboarded user,
  // so they are handled before the in-flow guard below.
  if (data.startsWith(ONB.feature)) {
    await ctx.answerCallbackQuery();
    const feature = data.slice(ONB.feature.length);
    if (isOnboardingFeature(feature)) {
      await FEATURE_HANDLERS[feature](ctx);
    }
    return;
  }

  const state = await loadOnboardingState(ctx);
  if (!state || ctx.user?.onboarded) {
    // A tap on a screen the user has already left. Acknowledge so the button
    // stops spinning; there is nothing to resume.
    await ctx.answerCallbackQuery();
    return;
  }

  if (data.startsWith(ONB.native)) {
    await handleNativeChosen(ctx, state, data.slice(ONB.native.length));
    return;
  }
  if (data === ONB.collapse) {
    await ctx.answerCallbackQuery();
    await showLanguagesScreen(ctx, state, null);
    return;
  }
  if (data === ONB.backToNative) {
    await ctx.answerCallbackQuery();
    await showNativeScreen(ctx, state);
    return;
  }
  if (data.startsWith(ONB.level)) {
    await handleLevelChosen(ctx, state, data.slice(ONB.level.length));
    return;
  }
  if (data.startsWith(ONB.language)) {
    await handleLanguageTapped(ctx, state, data.slice(ONB.language.length));
    return;
  }
  if (data === ONB.done) {
    await handleLanguagesDone(ctx, state);
    return;
  }
  if (data.startsWith(ONB.hook)) {
    await handleHookTapped(ctx, state, data.slice(ONB.hook.length));
    return;
  }

  await ctx.answerCallbackQuery();
}

/**
 * Screen 0 → 1. The native language is persisted immediately, so the choice
 * survives a restart and the next update can re-derive the whole flow from it.
 */
async function handleNativeChosen(ctx: BotContext, state: OnboardingState, code: string): Promise<void> {
  const known = ctx.services.languageCache.getSupportedLangs().some((entry) => entry.code === code);
  if (!known) {
    await ctx.answerCallbackQuery();
    return;
  }
  await ctx.answerCallbackQuery();

  const interfaceLang = inferInterfaceLang(code, ctx.from?.language_code);
  const learningLangs = state.learningLangs.filter((lang) => lang !== code);
  await ctx.services.userRepository.updateSettings(state.userId, {
    interfaceLang,
    nativeLang: code,
    learningLangs,
    lastSourceLang: null, // Cleared on re-onboard (Task 36).
  });
  logEvent("onboarding.native_lang_selected", { nativeLang: code, interfaceLang });

  await showLanguagesScreen(ctx, { ...state, nativeLang: code, interfaceLang, learningLangs }, null);
}

/** Screen 1: tapping a language opens its compact CEFR row in the same message. */
async function handleLanguageTapped(ctx: BotContext, state: OnboardingState, code: string): Promise<void> {
  const alreadyChosen = state.learningLangs.includes(code);
  if (!alreadyChosen && state.learningLangs.length >= MAX_LEARNING_LANGS) {
    await ctx.answerCallbackQuery({
      text: t("maxLangsReached", state.interfaceLang, { max: MAX_LEARNING_LANGS }),
      show_alert: true,
    });
    return;
  }
  await ctx.answerCallbackQuery();
  await showLanguagesScreen(ctx, state, code);
}

/**
 * Screen 1: a level tap collapses the row back into the language list. The
 * language is added to `learningLangs` only here, so it can never be persisted
 * without a level.
 */
async function handleLevelChosen(ctx: BotContext, state: OnboardingState, payload: string): Promise<void> {
  const separator = payload.lastIndexOf(":");
  if (separator <= 0) {
    await ctx.answerCallbackQuery();
    return;
  }
  const code = payload.slice(0, separator);
  const choice = payload.slice(separator + 1);

  if (choice === LEVEL_REMOVE) {
    await ctx.answerCallbackQuery({
      text: t("langRemoved", state.interfaceLang, { lang: ctx.services.languageCache.getLangDisplay(code) }),
    });
    const learningLangs = state.learningLangs.filter((lang) => lang !== code);
    await persistLearningLangs(ctx, state, learningLangs);
    const levels = { ...state.levels };
    delete levels[code];
    await showLanguagesScreen(ctx, { ...state, learningLangs, levels }, null);
    return;
  }

  // "🤷 I don't know" stores the schema default, so it is indistinguishable
  // downstream from an explicit B1.
  const level = choice === LEVEL_UNKNOWN ? DEFAULT_PROFICIENCY_LEVEL : choice;
  if (!isProficiencyLevel(level)) {
    await ctx.answerCallbackQuery();
    return;
  }

  const alreadyChosen = state.learningLangs.includes(code);
  if (!alreadyChosen && state.learningLangs.length >= MAX_LEARNING_LANGS) {
    await ctx.answerCallbackQuery({
      text: t("maxLangsReached", state.interfaceLang, { max: MAX_LEARNING_LANGS }),
      show_alert: true,
    });
    return;
  }
  await ctx.answerCallbackQuery();

  await ctx.services.userRepository.setLanguageLevel(state.userId, code, level);
  const learningLangs = alreadyChosen ? state.learningLangs : [...state.learningLangs, code];
  if (!alreadyChosen) {
    await persistLearningLangs(ctx, state, learningLangs);
  }
  logEvent("onboarding.learning_lang_confirmed", { langCode: code, level });

  await showLanguagesScreen(ctx, { ...state, learningLangs, levels: { ...state.levels, [code]: level } }, null);
}

/** Screen 1 → 2. */
async function handleLanguagesDone(ctx: BotContext, state: OnboardingState): Promise<void> {
  if (state.learningLangs.length === 0) {
    await ctx.answerCallbackQuery({ text: t("selectAtLeastOne", state.interfaceLang), show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery();
  logEvent("onboarding.languages_done", { learningLangs: state.learningLangs });
  await showDemoScreen(ctx, state);
}

/**
 * Screen 2: the payoff. A cached card renders instantly with no AI call at all; a
 * miss runs the real pipeline once (with its normal loader) and the result is
 * written back so the next user of that pair is instant.
 */
async function handleHookTapped(ctx: BotContext, state: OnboardingState, payload: string): Promise<void> {
  await ctx.answerCallbackQuery();

  const separator = payload.lastIndexOf(":");
  const sourceLang = payload.slice(0, separator);
  const index = Number(payload.slice(separator + 1));
  const headword = separator > 0 && Number.isInteger(index) ? resolveHookWord(sourceLang, index) : null;
  if (!headword || !state.nativeLang) {
    // An unresolvable button (a stale keyboard from an older curated list) must
    // not graduate the user with nothing to show for it — re-offer the screen.
    await showDemoScreen(ctx, state);
    return;
  }

  try {
    const served = await sendCachedDemoCard(ctx, {
      sourceLang,
      headword,
      nativeLang: state.nativeLang,
      interfaceLang: state.interfaceLang,
    });
    if (served) {
      await concludeDemo(ctx, state, "card", "hook_tapped");
      return;
    }

    const outcome = await runDemoTranslation(ctx, headword);
    if (outcome === "card") {
      await cacheDemoCard(ctx, { sourceLang, headword, nativeLang: state.nativeLang, sortOrder: index });
    }
    await concludeDemo(ctx, state, outcome, "hook_tapped");
  } catch (err) {
    await reportDemoFailure(ctx, state, err);
    await showFinalScreen(ctx, state);
  }
}

/** What a demo translation attempt actually produced. */
type DemoOutcome = "card" | "awaiting" | "none";

/**
 * True when the translate pipeline has asked the user something and is waiting
 * for the answer — a meaning clarification, a mistype confirmation, or an
 * "add this language?" prompt. These are *not* failures; they are the flow
 * mid-conversation, and burying them is worse than not completing.
 */
function isAwaitingUserReply(ctx: BotContext): boolean {
  const session = ctx.session;
  if (!session) return false;
  return Boolean(
    session.pendingClarification ||
      session.pendingOutOfSet ||
      session.pendingWord ||
      session.awaitingTranslationClarificationContext,
  );
}

/**
 * Run the production translate path and report what came out of it.
 *
 * `handleTranslateText` returns normally on several outcomes that produce **no
 * card**: a meaning clarification, an "add this language?" prompt, a quota
 * refusal, and input rejections (emoji, digits, too long). A rendered card is
 * detected by `session.pendingCardMsgId` advancing, which is what the translate
 * flow sets when it actually sends one.
 */
async function runDemoTranslation(ctx: BotContext, text: string): Promise<DemoOutcome> {
  const cardBefore = ctx.session?.pendingCardMsgId;
  await handleTranslateText(ctx, text);
  const cardAfter = ctx.session?.pendingCardMsgId;
  if (cardAfter !== undefined && cardAfter !== cardBefore) return "card";
  return isAwaitingUserReply(ctx) ? "awaiting" : "none";
}

/**
 * Close out the demo screen.
 *
 * The only outcome that must NOT complete is `awaiting`: the pipeline has asked
 * the user something and is holding the conversation open, so sending the
 * completion screen would bury the question and graduate them having never seen a
 * card. They stay on the demo screen; answering produces their card, and the next
 * word finishes the flow.
 *
 * `none` — input refused (emoji, digits, over-long), quota exhausted, or the
 * pipeline failing internally (`handleTranslateText` catches its own errors and
 * replies, so an outage never reaches our `catch`) — still completes. Being
 * marked onboarded is what unlocks the rest of the bot, and a broken model is not
 * the user's problem to solve. It is recorded as `failed` rather than as a
 * delivered card, so the funnel counts cards the user actually saw.
 */
async function concludeDemo(
  ctx: BotContext,
  state: OnboardingState,
  outcome: DemoOutcome,
  delivered: "hook_tapped" | "typed_word",
): Promise<void> {
  if (outcome === "awaiting") return;
  recordOnboardingStep(ONBOARDING_STEPS.demo, outcome === "card" ? delivered : "failed");
  await showFinalScreen(ctx, state);
}

/**
 * Free text during onboarding. At the demo screen it runs the real translate
 * path — loader, typing indicator, real card — and then completes onboarding. On
 * any earlier screen it re-renders that screen, so a user who types instead of
 * tapping is never left staring at nothing.
 *
 * Returns true when the message was consumed.
 */
export async function handleOnboardingText(ctx: BotContext, text: string): Promise<boolean> {
  if (ctx.user?.onboarded) return false;
  const state = await loadOnboardingState(ctx);
  if (!state) return false;

  if (state.step !== ONBOARDING_STEPS.demo) {
    await renderCurrentScreen(ctx, state);
    return true;
  }

  try {
    const outcome = await runDemoTranslation(ctx, text);
    await concludeDemo(ctx, state, outcome, "typed_word");
  } catch (err) {
    // A genuine pipeline failure is the one case that still completes: being
    // marked onboarded is what unlocks the rest of the bot, and a broken model is
    // not the user's problem to solve.
    await reportDemoFailure(ctx, state, err);
    await showFinalScreen(ctx, state);
  }

  return true;
}

/**
 * Catch taps on a keyboard left over from the conversation-based onboarding
 * (`lang:` / `learn:` / `level:`). Those prefixes are produced by nothing any
 * more, so without this they match no route: the callback is never answered and
 * the button spins forever.
 *
 * The tap is acknowledged and the user is put back on whichever screen their
 * stored state says they are on — no data is lost, because the new flow reads its
 * state from the database rather than from the message that was tapped. An
 * already-onboarded user with an ancient keyboard just gets the acknowledgement.
 */
export async function handleLegacyOnboardingCallback(ctx: BotContext): Promise<void> {
  await ctx.answerCallbackQuery();
  if (ctx.user?.onboarded) return;

  const state = await loadOnboardingState(ctx);
  if (!state) return;

  logEvent("onboarding.legacy_keyboard_recovered", { callbackData: ctx.callbackQuery?.data, step: state.step }, "warn");
  // Rendered in place, so the stale keyboard is replaced by a live one rather
  // than left above a duplicate. Past the 48-hour edit window the shared helper
  // falls back to a fresh message and `present` tracks it for cleanup.
  await renderCurrentScreen(ctx, state);
}

/**
 * Middleware seat for {@link handleOnboardingText}, installed just ahead of the
 * mode router. Commands, non-text updates and onboarded users pass straight
 * through, so nothing outside the unfinished-onboarding path is affected.
 */
export async function onboardingTextMiddleware(ctx: BotContext, next: NextFunction): Promise<void> {
  const text = ctx.message?.text;
  if (!text || text.startsWith("/") || ctx.user?.onboarded) {
    return next();
  }
  // Another flow is already waiting on this message. No command is gated on
  // `onboarded`, so a user can open /settings, /dictionary or /mentor mid-flow and
  // owe that flow a free-text answer; the mode router owns them, and stealing the
  // reply here would hang them exactly the way the old conversation hung the chat
  // — the bug class this module exists to remove.
  if (
    ctx.session?.activeMode === "mentor" ||
    ctx.session?.awaitingNotifContext ||
    ctx.session?.dictionaryWizard ||
    ctx.session?.awaitingTranslationClarificationContext
  ) {
    return next();
  }
  const handled = await handleOnboardingText(ctx, text);
  if (!handled) {
    return next();
  }
}

/**
 * A failed demo must never strand the user: the apology is shown and onboarding
 * still completes, because being marked onboarded is what unlocks the rest of
 * the bot.
 */
async function reportDemoFailure(ctx: BotContext, state: OnboardingState, err: unknown): Promise<void> {
  logEvent("onboarding.demo_failed", errorFields(err), "error");
  recordOnboardingStep(ONBOARDING_STEPS.demo, "failed");
  await ctx.reply(t("onbDemoFailed", state.interfaceLang));
}

/**
 * `updateSettings` is an upsert over the whole settings row, so the columns that
 * are `NOT NULL` have to be supplied every time.
 */
async function persistLearningLangs(ctx: BotContext, state: OnboardingState, learningLangs: string[]): Promise<void> {
  await ctx.services.userRepository.updateSettings(state.userId, {
    interfaceLang: state.interfaceLang,
    nativeLang: state.nativeLang ?? state.interfaceLang,
    learningLangs,
  });
}
