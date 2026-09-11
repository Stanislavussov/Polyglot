import { getLangFlag } from "./language-registry.js";
import type { I18nKey } from "./types.js";

/** The two long operations that show a rotating loader. */
export type LoaderKind = "translate" | "mentor";

/**
 * Loader phrases grouped by how long the user has already been waiting: index 0
 * is what appears immediately, each later stage replaces it as the wait drags on.
 *
 * These are the INTERFACE-language fallback, shown only when the user has no
 * learning language with a phrase set of its own — normally the loader speaks
 * {@link WAIT_PHRASES} instead. The variants inside a stage are interchangeable,
 * so neither a single long wait nor two waits in a row read identically.
 */
const LOADER_PHRASE_KEYS: Record<LoaderKind, readonly (readonly I18nKey[])[]> = {
  translate: [
    ["loaderTranslateStart1", "loaderTranslateStart2", "loaderTranslateStart3"],
    ["loaderTranslateWait1", "loaderTranslateWait2", "loaderTranslateWait3"],
    ["loaderTranslateAlmost1", "loaderTranslateAlmost2", "loaderTranslateAlmost3"],
  ],
  mentor: [
    ["loaderMentorStart1", "loaderMentorStart2", "loaderMentorStart3"],
    ["loaderMentorWait1", "loaderMentorWait2", "loaderMentorWait3"],
    ["loaderMentorAlmost1", "loaderMentorAlmost2", "loaderMentorAlmost3"],
  ],
};

/**
 * Thematic glyphs the loader leads with, drawn fresh on every tick. The phrase
 * itself is in a language the user is still learning, so the emoji is what
 * carries "what is happening" to someone who cannot read the words yet.
 */
const LOADER_EMOJI: Record<LoaderKind, readonly string[]> = {
  translate: ["🔤", "📖", "🌍", "✍️", "🔍", "📚", "✨", "🎁"],
  mentor: ["🧠", "💭", "🤔", "📚", "🧩", "✏️", "💡"],
};

/**
 * Everyday "hold on a moment" expressions, written IN the language being learned
 * — the waiting time is dead air otherwise, and these are exactly the colloquial
 * filler a textbook never teaches. Staged like {@link LOADER_PHRASE_KEYS}: a
 * plain "one second" first, "still on it" next, "almost there" last, so the
 * meaning tracks the wait even for a reader who only half-recognizes the words.
 *
 * Deliberately mild — spoken, friendly, nothing a learner would be embarrassed
 * to repeat. Keyed by the same ISO 639-1 codes the `languages` table marks
 * `is_supported`, which is the set a user can pick as a learning language; a code
 * absent here simply falls back to the interface-language phrases.
 */
const WAIT_PHRASES: Record<string, readonly (readonly string[])[]> = {
  en: [
    ["Hang on", "Just a sec", "Give me a moment"],
    ["Still on it", "Bear with me", "Working on it"],
    ["Almost there", "Nearly done", "Any second now"],
  ],
  ru: [
    ["Секундочку", "Момент", "Сейчас будет"],
    ["Ещё колдую", "Всё ещё думаю", "Уже в процессе"],
    ["Почти готово", "Вот-вот", "Ещё чуть-чуть"],
  ],
  uk: [
    ["Секундочку", "Хвилинку", "Зараз буде"],
    ["Ще працюю", "Ще чаклую", "Уже в процесі"],
    ["Майже готово", "Ось-ось", "Ще трішки"],
  ],
  cs: [
    ["Vteřinku", "Momentík", "Hned to bude"],
    ["Ještě na tom dělám", "Pořád makám", "Chvilku strpení"],
    ["Už to skoro je", "Ještě chvilku", "Za chviličku"],
  ],
  de: [
    ["Moment mal", "Sekunde", "Einen Augenblick"],
    ["Bin noch dran", "Dauert kurz", "Gleich hab ich's"],
    ["Fast fertig", "Gleich so weit", "Nur noch kurz"],
  ],
  fr: [
    ["Une seconde", "Deux secondes", "Un instant"],
    ["J'y suis encore", "Ça arrive", "Patiente un peu"],
    ["Presque fini", "Plus qu'un instant", "J'y suis presque"],
  ],
  es: [
    ["Un segundito", "Dame un momento", "Ahora mismo"],
    ["Sigo en ello", "Todavía dándole", "Un poquito más"],
    ["Casi listo", "Ya mismo", "Un pelín más"],
  ],
  it: [
    ["Un attimo", "Un secondo", "Arrivo"],
    ["Ci sto ancora", "Sto lavorando", "Abbi pazienza"],
    ["Quasi fatto", "Ci siamo quasi", "Ancora un attimo"],
  ],
  pt: [
    ["Um segundinho", "Só um instante", "Já vai"],
    ["Ainda cá ando", "Ainda a trabalhar nisso", "Mais um bocadinho"],
    ["Quase pronto", "Falta pouco", "Já está quase"],
  ],
  pl: [
    ["Sekundka", "Momencik", "Zaraz będzie"],
    ["Jeszcze działam", "Wciąż nad tym siedzę", "Chwilunia"],
    ["Już prawie", "Zaraz kończę", "Jeszcze momencik"],
  ],
  kk: [
    ["Бір секунд", "Сәл күте тұрыңыз", "Қазір болады"],
    ["Әлі істеп жатырмын", "Сәл шыдаңыз", "Жұмыс үстінде"],
    ["Дайын болып қалды", "Тағы сәл", "Бітуге жақын"],
  ],
};

/** Clamps a stage index to the last stage once the wait outruns the list. */
function atStage<T>(stages: readonly T[], stage: number): T {
  return stages[Math.min(Math.max(stage, 0), stages.length - 1)] as T;
}

/** Interface-language fallback variants for `stage`. */
export function loaderPhraseKeys(kind: LoaderKind, stage: number): readonly I18nKey[] {
  return atStage(LOADER_PHRASE_KEYS[kind], stage);
}

/** Every fallback phrase key of a kind, in stage order. */
export function allLoaderPhraseKeys(kind: LoaderKind): readonly I18nKey[] {
  return LOADER_PHRASE_KEYS[kind].flat();
}

/** The glyphs a `kind` may lead with. */
export function loaderEmoji(kind: LoaderKind): readonly string[] {
  return LOADER_EMOJI[kind];
}

/** True when `langCode` can carry the loader in the language itself. */
export function hasWaitPhrases(langCode: string): boolean {
  return langCode in WAIT_PHRASES;
}

/** The learning-language variants for `stage`, empty for an uncovered language. */
export function waitPhrases(langCode: string, stage: number): readonly string[] {
  const stages = WAIT_PHRASES[langCode];
  return stages ? atStage(stages, stage) : [];
}

/**
 * One rendered loader line: a thematic glyph, the flag of the language being
 * spoken, and the phrase itself. The flag is what tells the learner WHICH of
 * their languages is talking to them — without it a short phrase in a language
 * they half-know is just a puzzle.
 */
export function composeLoaderText(emoji: string, langCode: string, phrase: string): string {
  const flag = getLangFlag(langCode);
  return `${emoji} ${flag ? `${flag} ` : ""}${phrase}...`;
}

/**
 * Every learning-language line a loader of this kind could ever render for
 * `langCode`. The rendering is a random draw, so a caller that has to RECOGNIZE
 * a loader message (a test asserting the bot deleted its own placeholder, say)
 * needs the whole candidate set rather than the one string it happened to draw.
 */
export function loaderTextsFor(kind: LoaderKind, langCode: string, stage: number): readonly string[] {
  return LOADER_EMOJI[kind].flatMap((emoji) =>
    waitPhrases(langCode, stage).map((phrase) => composeLoaderText(emoji, langCode, phrase)),
  );
}

/** Every learning-language line of a kind across all covered languages and stages. */
export function allLoaderTexts(kind: LoaderKind): readonly string[] {
  return Object.keys(WAIT_PHRASES).flatMap((langCode) =>
    [0, 1, 2].flatMap((stage) => loaderTextsFor(kind, langCode, stage)),
  );
}
