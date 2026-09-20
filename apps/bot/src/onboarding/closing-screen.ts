/**
 * The closing onboarding screen — the message that hands a newcomer the product.
 *
 * Two things make it different from every other screen, and both are deliberate:
 *
 *  - **It describes the live UI, never a copy of it.** The button list is read off
 *    the very keyboards the bot renders (`buildCardKeyboard` for the card the user
 *    is looking at, `mainMenuEntries` for the hot buttons) and the trial block off
 *    the live plan catalog. The previous version was one frozen paragraph per
 *    locale, and it had already drifted: it taught "🔄 Другое значение / 🎯
 *    Уточнить значение" as buttons under the card at a point where both had moved
 *    behind `🔍 Explore`, and it sold the trial under ⭐ — the glyph of Plus —
 *    while the trial has granted Pro (💎) since Task 84. Nothing here can drift
 *    that way again: retire a button and its line disappears with it.
 *  - **It is sent late, and as a reply.** The card lands first and the instructions
 *    follow {@link CLOSING_SCREEN_DELAY_MS} later, attached to the message that was
 *    translated — so the newcomer reads their card instead of having it pushed up
 *    the screen by a wall of text, and the instructions still point at the thing
 *    they are about.
 */
import {
  errorFields,
  type I18nKey,
  logEvent,
  type Subscription,
  type SupportedLang,
  TRIAL_DAYS,
  TRIAL_EXTENSION_DAYS,
  TRIAL_EXTENSION_WORDS,
  t,
} from "@polyglot/core";
import type { InlineKeyboard } from "grammy";
import { ONBOARDING_SCREENCAST_FILE_ID } from "../constants.js";
import { MAIN_KEYBOARD_VERSION } from "../middlewares/main-keyboard.js";
import { buildTranslationKeyboard } from "../renderers/translation.renderer.js";
import { buildCardKeyboard } from "../scenes/helpers/card-keyboard.js";
import { describePlan } from "../scenes/helpers/subscription.helper.js";
import type { BotContext } from "../types.js";
import { buildMainKeyboard, mainMenuEntries } from "../utils/main-menu.js";
import type { OnboardingState } from "./onboarding-state.js";

/**
 * How long the card is left alone before the instructions arrive.
 *
 * Fifteen seconds is roughly how long the first card takes to read. Sending both
 * in one turn buried the payoff: the screen the whole flow exists to produce
 * scrolled away under a screenful of instructions the moment it appeared.
 */
export const CLOSING_SCREEN_DELAY_MS = 15_000;

/** The callback prefix the `🔍 Explore` button carries — the one button that opens others. */
const EXPLORE_PREFIX = "tr:more:";

/**
 * Card button → the line that explains it, keyed by the callback prefix the button
 * carries rather than its label (labels are translated, callback data is not).
 *
 * A button with no entry here is left undescribed on purpose: `← Back`, the
 * source-language flags and the non-actionable header they sit under are
 * navigation, not features, and listing them would pad the one screen that has to
 * stay readable. `closing-screen.test.ts` pins that set, so a *new* card button
 * arriving without a hint fails there rather than quietly going unmentioned.
 */
export const CARD_BUTTON_HINTS: ReadonlyArray<readonly [prefix: string, hint: I18nKey]> = [
  ["tr:say:", "cardHintPronounce"],
  [EXPLORE_PREFIX, "cardHintExplore"],
  ["tr:clarifypost:", "cardHintClarify"],
  ["tr:altmeaning:", "cardHintOtherMeaning"],
  ["tr:mentor:", "cardHintMentor"],
  ["tr:etymology:", "cardHintEtymology"],
  ["tr:save:", "cardHintSave"],
];

/** Indent for the actions that only appear once `🔍 Explore` is tapped. */
const NESTED_INDENT = "   ";

/** One inline button, reduced to what this screen needs from it. */
interface DescribableButton {
  readonly label: string;
  readonly data: string;
}

function buttonsOf(keyboard: InlineKeyboard): DescribableButton[] {
  return keyboard.inline_keyboard.flat().flatMap((button) => {
    const data = "callback_data" in button ? button.callback_data : undefined;
    return typeof data === "string" ? [{ label: button.text, data }] : [];
  });
}

function hintFor(data: string): I18nKey | undefined {
  return CARD_BUTTON_HINTS.find(([prefix]) => data.startsWith(prefix))?.[1];
}

/**
 * The card's keyboard in both of its states, as the user will actually see it.
 *
 * Taken from the session entry of the card just rendered, so the description
 * matches that card down to the speaker languages and the plan badges on it. The
 * fallback covers the path where the demo produced no card at all (input refused,
 * quota spent, the pipeline down) — the user is still graduated and still needs
 * the instructions, so a representative keyboard is described instead. A failure
 * to re-derive the real one lands in the same place: a missing hand-off is a far
 * worse outcome than a generic one.
 */
async function cardKeyboards(
  ctx: BotContext,
  state: OnboardingState,
  lang: SupportedLang,
): Promise<{ collapsed: InlineKeyboard; expanded: InlineKeyboard }> {
  const msgId = ctx.session?.pendingCardMsgId;
  const entry = msgId === undefined ? undefined : ctx.session?.translationMap?.[String(msgId)];

  if (entry && msgId !== undefined && state.nativeLang) {
    try {
      return {
        collapsed: await buildCardKeyboard(ctx, { ...entry, actionsExpanded: false }, msgId, lang, state.nativeLang),
        expanded: await buildCardKeyboard(ctx, { ...entry, actionsExpanded: true }, msgId, lang, state.nativeLang),
      };
    } catch (err) {
      logEvent("onboarding.closing_card_keyboard_failed", errorFields(err), "warn");
    }
  }

  const options = { interfaceLang: lang, showMentorButton: true, showEtymologyButton: true };
  return {
    collapsed: buildTranslationKeyboard(options),
    expanded: buildTranslationKeyboard({ ...options, expanded: true }),
  };
}

/**
 * The card's buttons as prose, in keyboard order, with the actions behind
 * `🔍 Explore` nested under it.
 *
 * `seen` is what keeps the speakers out of the nested list: they sit on both the
 * collapsed and the expanded keyboard by design (hearing a word must not cost a
 * tap), so walking the expanded one afterwards would name them twice.
 */
function describeCardButtons(collapsed: InlineKeyboard, expanded: InlineKeyboard, lang: SupportedLang): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const button of buttonsOf(collapsed)) {
    const hint = hintFor(button.data);
    if (!hint || seen.has(button.data)) continue;
    seen.add(button.data);
    lines.push(`${button.label} — ${t(hint, lang)}`);
    if (!button.data.startsWith(EXPLORE_PREFIX)) continue;

    for (const action of buttonsOf(expanded)) {
      const actionHint = hintFor(action.data);
      if (!actionHint || seen.has(action.data)) continue;
      seen.add(action.data);
      lines.push(`${NESTED_INDENT}${action.label} — ${t(actionHint, lang)}`);
    }
  }

  return lines;
}

/**
 * The gift, described by the plan the ledger actually granted.
 *
 * Both halves of the announcement name that plan and wear its glyph, and the
 * middle is the catalog's own list of what it buys — the same lines the upgrade
 * screen sells it with. The plan catalog is admin-owned, so an edit in the panel
 * reaches this screen without a deploy, and the promise here can never outlive
 * the plan it describes. A plan the catalog does not know falls back to its bare
 * name with no list: a wrong list is worse than none.
 */
async function trialBlock(ctx: BotContext, trial: Subscription, lang: SupportedLang): Promise<string> {
  const plan = await describePlan(ctx, trial.plan, lang);
  const granted = t("onbTrialGranted", lang, {
    emoji: plan?.emoji ?? "✨",
    days: String(TRIAL_DAYS),
    plan: plan?.label ?? trial.plan,
  });
  const after = t("onbTrialAfter", lang, {
    words: String(TRIAL_EXTENSION_WORDS),
    plan: plan?.label ?? trial.plan,
    extraDays: String(TRIAL_EXTENSION_DAYS),
  });
  const bullets = (plan?.bullets ?? []).map((line) => `• ${line}`);
  return [bullets.length > 0 ? [granted, ...bullets].join("\n") : granted, after].join("\n\n");
}

/** The closing screen's text, assembled from the UI the user is looking at. */
export async function buildClosingText(
  ctx: BotContext,
  state: OnboardingState,
  trial: Subscription | null,
): Promise<string> {
  const lang = state.interfaceLang;
  const { collapsed, expanded } = await cardKeyboards(ctx, state, lang);

  const blocks = [
    t("onbClosingIntro", lang),
    [t("onbClosingCardHeader", lang), ...describeCardButtons(collapsed, expanded, lang)].join("\n"),
    t("onbClosingReview", lang),
    [
      t("onbClosingKeyboardHeader", lang),
      ...mainMenuEntries(lang).map((entry) => `${entry.label} — ${entry.hint}`),
      t("onbClosingMoreInMenu", lang),
    ].join("\n"),
    t("onbClosingCta", lang),
  ];

  if (trial) blocks.push(await trialBlock(ctx, trial, lang));

  return blocks.join("\n\n");
}

/** A closing screen waiting out its delay. */
interface PendingClosing {
  timer: ReturnType<typeof setTimeout>;
  send: () => Promise<void>;
}

const pending = new Set<PendingClosing>();

/**
 * Hand the closing screen to a timer and return.
 *
 * Returning immediately is the point: updates are sequentialized per chat, so
 * waiting out the delay inside the handler would leave the bot deaf to that user
 * for fifteen seconds — the exact shape of the "bot went silent" failures this
 * flow was rebuilt to remove.
 *
 * The keyboard-version flag is set here rather than after the send, because the
 * session is written back when *this* update ends and a mutation from the timer
 * would be dropped. The trade is deliberate: a restart inside the delay window
 * costs that user the hand-off, while leaving the flag unset would re-send the
 * menu hint to every user on their next message.
 */
export function scheduleClosingScreen(ctx: BotContext, text: string, lang: SupportedLang): void {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  const api = ctx.api;
  // The message being translated when there is one; the card itself when the
  // newcomer tapped a curated word and never typed anything.
  const replyTo = ctx.message?.message_id ?? ctx.session?.pendingCardMsgId;

  if (ctx.session) ctx.session.mainKeyboardVersion = MAIN_KEYBOARD_VERSION;

  const send = async (): Promise<void> => {
    try {
      if (ONBOARDING_SCREENCAST_FILE_ID) {
        await api.sendAnimation(chatId, ONBOARDING_SCREENCAST_FILE_ID);
      }
    } catch (err) {
      logEvent("onboarding.screencast_failed", errorFields(err), "warn");
    }
    try {
      await api.sendMessage(chatId, text, {
        reply_markup: buildMainKeyboard(lang),
        // A newcomer can delete their own message while the timer runs; without
        // this the reply would be refused and the hand-off lost with it.
        ...(replyTo === undefined
          ? {}
          : { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } }),
      });
    } catch (err) {
      logEvent("onboarding.closing_send_failed", errorFields(err), "error");
    }
  };

  const task: PendingClosing = {
    send,
    timer: setTimeout(() => {
      pending.delete(task);
      void send();
    }, CLOSING_SCREEN_DELAY_MS),
  };
  // Nothing may hold up a shutdown for fifteen seconds; the user's next message
  // re-delivers the keyboard if the process went down before the timer fired.
  task.timer.unref?.();
  pending.add(task);
}

/**
 * Send every waiting closing screen now, instead of on its timer.
 *
 * The test seam for the delay: the integration lane cannot use fake timers (they
 * stall the pg driver) and must not sleep, so a test drives the flow, asserts
 * nothing was sent, then flushes and asserts the message.
 */
export async function flushScheduledClosings(): Promise<void> {
  const tasks = [...pending];
  pending.clear();
  await Promise.all(
    tasks.map(async (task) => {
      clearTimeout(task.timer);
      await task.send();
    }),
  );
}
