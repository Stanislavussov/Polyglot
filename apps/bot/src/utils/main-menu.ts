/**
 * Main menu — the reply keyboard behind the keyboard icon next to the input field.
 *
 * The entry points a user reaches for every session — `/pick`, `/dictionary`,
 * `/flashcard`, `/videos` — sit here so they are one tap away instead of buried in
 * the command list. They remain in the command list too (see `commands.ts`): a reply keyboard
 * only exists as long as the message that delivered it, so the command menu is the
 * path that survives a cleared chat history.
 */

import { getSupportedLangs, type I18nKey, type SupportedLang, t } from "@polyglot/core";
import { Keyboard } from "grammy";

interface MainMenuItem {
  /** Identifies the handler this button routes to; also the name of its command. */
  readonly action: MainMenuAction;
  /** Emoji shown before the label — language independent, same convention as command icons. */
  readonly icon: string;
  readonly labelKey: I18nKey;
}

export type MainMenuAction = "pick" | "dictionary" | "flashcard" | "videos";

/**
 * Rows of the keyboard, in render order.
 *
 * "Pick words" sits alone on the first row: it is the answer to "I opened the
 * bot, now what?", and a full-width button is the only emphasis a reply keyboard
 * offers. The three everyday entry points share the second row.
 */
const MAIN_MENU_ROWS: ReadonlyArray<readonly MainMenuItem[]> = [
  [{ action: "pick", icon: "✨", labelKey: "menuBtnPickWords" }],
  [
    { action: "dictionary", icon: "📖", labelKey: "menuBtnDictionary" },
    { action: "flashcard", icon: "🎴", labelKey: "menuBtnFlashcards" },
    { action: "videos", icon: "🎬", labelKey: "menuBtnVideos" },
  ],
];

function buttonLabel(item: MainMenuItem, lang: SupportedLang): string {
  return `${item.icon} ${t(item.labelKey, lang)}`;
}

/**
 * Builds the main-menu reply keyboard for the given interface language.
 *
 * Two rows and no more, with the three everyday entry points sharing the lower one
 * at the density Telegram renders comfortably.
 *
 * That puts a width budget on the labels of the shared row: a 360dp-wide chat leaves roughly 104dp per
 * button, so a `menuBtn*` translation should stay near 9–10 characters. The two that
 * busted it were shortened rather than given an abbreviation — fr `Dictionnaire` → `Mots`
 * and kk `Карточкалар` → `Карталар`, both natural words the icon disambiguates. Going over
 * budget is not fatal (Telegram wraps the label and grows the row instead of cutting it
 * off), but keep new translations inside it so the menu stays one tidy line.
 *
 * The menu is deliberately NOT `persistent()`: a pinned keyboard eats the bottom of
 * every screen for the entire life of the chat, which is a permanent tax for
 * something a user reaches for a few times a session. `oneTime()` instead hands it
 * to the client and lets it fold away after use — it is then one tap away behind
 * the keyboard icon next to the input field, which is where Telegram users already
 * look for a bot's menu. The onboarding hand-off names that icon, so the menu is
 * never something the user has to discover by accident.
 */
export function buildMainKeyboard(lang: SupportedLang): Keyboard {
  const kb = new Keyboard();
  MAIN_MENU_ROWS.forEach((row, index) => {
    if (index > 0) kb.row();
    for (const item of row) {
      kb.text(buttonLabel(item, lang));
    }
  });
  return kb.resized().oneTime();
}

let labelIndex: Map<string, MainMenuAction> | undefined;

/**
 * Label → action lookup across *every* supported language.
 *
 * A reply keyboard lives in Telegram's UI until the bot replaces it, so a user who
 * switches interface language still has the old labels on screen. Matching every
 * locale means those taps keep working instead of being translated as a word.
 */
function getLabelIndex(): Map<string, MainMenuAction> {
  if (!labelIndex) {
    labelIndex = new Map();
    for (const lang of getSupportedLangs()) {
      for (const item of MAIN_MENU_ROWS.flat()) {
        labelIndex.set(buttonLabel(item, lang), item.action);
      }
    }
  }
  return labelIndex;
}

/** Every main-menu label in every language — the match list for `bot.hears`. */
export function mainMenuLabels(): string[] {
  return [...getLabelIndex().keys()];
}

/** Resolves an incoming message text to a main-menu action, or `undefined` if it is not a button. */
export function matchMainMenuAction(text: string): MainMenuAction | undefined {
  return getLabelIndex().get(text.trim());
}
