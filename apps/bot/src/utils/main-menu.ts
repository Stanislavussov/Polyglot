/**
 * Main menu — the persistent reply keyboard under the input field.
 *
 * Frequently used entry points that used to sit in the Telegram command list
 * (`/dictionary`, `/flashcard`, `/videos`) live here instead: the command list is
 * for rare, configuration-style actions, the keyboard is for the ones a user taps
 * every session. The commands themselves still work — they are simply no longer
 * advertised in the menu (see `commands.ts`).
 */

import { getSupportedLangs, type I18nKey, type SupportedLang, t } from "@polyglot/core";
import { Keyboard } from "grammy";

interface MainMenuItem {
  /** Identifies the handler this button routes to. */
  readonly action: MainMenuAction;
  /** Emoji shown before the label — language independent, same convention as command icons. */
  readonly icon: string;
  readonly labelKey: I18nKey;
}

export type MainMenuAction = "dictionary" | "flashcard" | "videos";

const MAIN_MENU_ITEMS: readonly MainMenuItem[] = [
  { action: "dictionary", icon: "📖", labelKey: "menuBtnDictionary" },
  { action: "flashcard", icon: "🎴", labelKey: "menuBtnFlashcards" },
  { action: "videos", icon: "🎬", labelKey: "menuBtnVideos" },
];

function buttonLabel(item: MainMenuItem, lang: SupportedLang): string {
  return `${item.icon} ${t(item.labelKey, lang)}`;
}

/**
 * Builds the persistent reply keyboard for the given interface language.
 *
 * All entries sit on a **single row**: the keyboard is persistent, so every extra row
 * permanently eats chat space, and three buttons is the standard density Telegram
 * renders comfortably.
 *
 * That puts a width budget on the labels: a 360dp-wide chat leaves roughly 104dp per
 * button, so a `menuBtn*` translation should stay near 9–10 characters. The two that
 * busted it were shortened rather than given an abbreviation — fr `Dictionnaire` → `Mots`
 * and kk `Карточкалар` → `Карталар`, both natural words the icon disambiguates. Going over
 * budget is not fatal (Telegram wraps the label and grows the row instead of cutting it
 * off), but keep new translations inside it so the menu stays one tidy line.
 *
 * `persistent()` keeps it open instead of collapsing into the keyboard icon, so the
 * menu is visible without the user knowing to look for it.
 */
export function buildMainKeyboard(lang: SupportedLang): Keyboard {
  const kb = new Keyboard();
  for (const item of MAIN_MENU_ITEMS) {
    kb.text(buttonLabel(item, lang));
  }
  return kb.resized().persistent();
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
      for (const item of MAIN_MENU_ITEMS) {
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
