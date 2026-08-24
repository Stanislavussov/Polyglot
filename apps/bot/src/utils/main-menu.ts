/**
 * Hot buttons — the reply keyboard behind the keyboard icon next to the input field.
 *
 * Three buttons, and deliberately not a menu: the deck, the mentor and the dictionary are
 * what a learner reaches for several times a session, so they are one tap with nothing in
 * front of them. Everything else — the other practice modes, settings, the bug report —
 * lives behind `/menu`, which arrives as its own message (see `menu.scene.ts`).
 *
 * The command list (`commands.ts`) carries the same entry points, because a reply keyboard
 * only exists as long as the message that delivered it: clearing the chat history takes the
 * keyboard with it, and the command menu is the path that survives that.
 */

import { getSupportedLangs, type I18nKey, type SupportedLang, t } from "@polyglot/core";
import { Keyboard } from "grammy";

/** A hot button — one tap, no menu in front of it. */
export type MainMenuAction = "flashcard" | "mentor" | "dictionary";

/**
 * Entry points that used to have their own keyboard button and now live inside `/menu`.
 * Still matched — see {@link LEGACY_MENU_LABELS}.
 */
export type LegacyMenuAction = "pick" | "videos";

export type MenuTapAction = MainMenuAction | LegacyMenuAction;

/** A resolved keyboard tap: which handler to run, and whether the label was a retired one. */
export interface MenuTap {
  readonly action: MenuTapAction;
  readonly legacy: boolean;
}

interface MenuItem {
  readonly action: MenuTapAction;
  /** Emoji shown before the label — language independent, same convention as command icons. */
  readonly icon: string;
  readonly labelKey: I18nKey;
}

/**
 * The keyboard, in render order.
 *
 * One row of three, which is the density Telegram renders on a single line. That is the
 * width budget the labels are cut to: a 360dp chat leaves roughly 104dp per button, so a
 * `menuBtn*` translation here should stay near 9–10 characters — es `Diccionario` (11) is
 * the widest and wraps rather than truncating.
 */
const MAIN_MENU_ROWS: ReadonlyArray<readonly MenuItem[]> = [
  [
    { action: "flashcard", icon: "🎴", labelKey: "menuBtnFlashcards" },
    { action: "mentor", icon: "🧑‍🏫", labelKey: "menuBtnMentor" },
    { action: "dictionary", icon: "📖", labelKey: "menuBtnDictionary" },
  ],
];

/**
 * Labels retired keyboards are still showing, frozen exactly as they shipped.
 *
 * A reply keyboard lives in the Telegram client until the bot sends a new one, so between
 * this deploy and a user's next message their screen still carries an older layout. Two
 * generations are still out there: the long "✨ Подобрать слова" form, and the one-word
 * "✨ Подбор" form that replaced it when a fifth button joined the row. Dropping either
 * would send the tap past `bot.hears` into the mode router, and the bot would *translate
 * the word "Подбор"* instead of opening the picker.
 *
 * Only `pick` and `videos` need entries: they left the keyboard for `/menu`. The three
 * live hot buttons keep their shipped labels, so those are already indexed as current.
 *
 * The strings are literals rather than `t()` lookups on purpose. The keys are still live —
 * `menuBtnPickWords` labels the button inside the learning hub — and a translator improving
 * one of them must not silently retire an alias that is still on somebody's screen. These
 * are historical artifacts, not translations; the whole table goes once `menu.legacy_tap`
 * stops firing.
 */
const LEGACY_MENU_LABELS: ReadonlyArray<readonly [MenuTapAction, readonly string[]]> = [
  [
    "pick",
    [
      // The long form, from before the row had to fit five buttons.
      "✨ Pick words",
      "✨ Подобрать слова",
      "✨ Vybrat slova",
      "✨ Wörter finden",
      "✨ Elegir palabras",
      "✨ Trouver des mots",
      "✨ Scegli parole",
      "✨ Сөз таңдау",
      "✨ Dobierz słowa",
      "✨ Escolher palavras",
      "✨ Підібрати слова",
      // The one-word form that replaced it.
      "✨ Pick",
      "✨ Подбор",
      "✨ Výběr",
      "✨ Auswahl",
      "✨ Elegir",
      "✨ Choisir",
      "✨ Scegli",
      "✨ Таңдау",
      "✨ Dobierz",
      "✨ Escolher",
      "✨ Підбір",
    ],
  ],
  [
    "videos",
    ["🎬 Videos", "🎬 Видео", "🎬 Videa", "🎬 Vídeos", "🎬 Vidéos", "🎬 Video", "🎬 Бейнелер", "🎬 Filmy", "🎬 Відео"],
  ],
];

function buttonLabel(item: MenuItem, lang: SupportedLang): string {
  return `${item.icon} ${t(item.labelKey, lang)}`;
}

/**
 * Builds the hot-button keyboard for the given interface language.
 *
 * Deliberately NOT `persistent()`: a pinned keyboard eats the bottom of every screen for
 * the entire life of the chat, which is a permanent tax for something a user reaches for a
 * few times a session. `oneTime()` hands it to the client and lets it fold away after use —
 * it is then one tap away behind the keyboard icon next to the input field, which is where
 * Telegram users already look for a bot's menu. The onboarding hand-off names that icon, so
 * the keyboard is never something the user has to discover by accident.
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

let labelIndex: Map<string, MenuTap> | undefined;

/**
 * Label → tap lookup across *every* supported language.
 *
 * A reply keyboard lives in Telegram's UI until the bot replaces it, so a user who
 * switches interface language still has the old labels on screen. Matching every
 * locale means those taps keep working instead of being translated as a word.
 *
 * Current labels are indexed first so a retired label that happens to render
 * identically can never shadow a live category.
 */
function getLabelIndex(): Map<string, MenuTap> {
  if (!labelIndex) {
    const index = new Map<string, MenuTap>();
    for (const lang of getSupportedLangs()) {
      for (const item of MAIN_MENU_ROWS.flat()) {
        index.set(buttonLabel(item, lang), { action: item.action, legacy: false });
      }
    }
    for (const [action, labels] of LEGACY_MENU_LABELS) {
      for (const label of labels) {
        if (!index.has(label)) {
          index.set(label, { action, legacy: true });
        }
      }
    }
    labelIndex = index;
  }
  return labelIndex;
}

/** Every menu label in every language, live and retired — the match list for `bot.hears`. */
export function mainMenuLabels(): string[] {
  return [...getLabelIndex().keys()];
}

/** Resolves an incoming message text to a menu tap, or `undefined` if it is not a button. */
export function matchMenuTap(text: string): MenuTap | undefined {
  return getLabelIndex().get(text.trim());
}
