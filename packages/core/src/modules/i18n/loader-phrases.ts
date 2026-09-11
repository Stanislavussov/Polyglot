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
  translate: ["🔤", "📖", "🌍", "✍️", "🔍", "📚", "✨", "🎁", "🗺️", "📝", "🔠", "💬"],
  mentor: ["🧠", "💭", "🤔", "📚", "🧩", "✏️", "💡", "🎓", "🔎", "📔"],
};

/**
 * Everyday "hold on a moment" expressions, written IN the language being learned
 * — the waiting time is dead air otherwise, and these are exactly the colloquial
 * filler a textbook never teaches. Six stages deep, walking from "one second"
 * through "still on it" and "thanks for waiting" to "any second now", so the
 * meaning tracks the wait even for a reader who only half-recognizes the words —
 * and five interchangeable variants per stage, which together with the glyph pool
 * is what keeps a loader the user meets dozens of times a day from wearing out.
 *
 * Deliberately mild — spoken, friendly, nothing a learner would be embarrassed
 * to repeat. Keyed by the same ISO 639-1 codes the `languages` table marks
 * `is_supported`, which is the set a user can pick as a learning language; a code
 * absent here simply falls back to the interface-language phrases.
 */
const WAIT_PHRASES: Record<string, readonly (readonly string[])[]> = {
  en: [
    ["Hang on", "Just a sec", "One moment", "Give me a second", "Coming right up"],
    ["Still here", "On it", "Working on it", "Under way", "Here we go"],
    ["Still on it", "Bear with me", "Digging in", "Don't go anywhere", "Hold tight"],
    ["Thanks for waiting", "A little longer", "Still going", "Slower than usual today", "Hang in there"],
    ["Almost there", "Nearly done", "Any moment", "Final touches", "Almost at the line"],
    ["One more second", "So close now", "Last stretch", "Right about now", "Just finishing"],
  ],
  ru: [
    ["Секундочку", "Момент", "Сейчас будет", "Одну секунду", "Уже начинаю"],
    ["Я тут", "Взялся", "Работаю", "Уже в процессе", "Погнали"],
    ["Ещё колдую", "Всё ещё думаю", "Копаю", "Не переключайтесь", "Держитесь"],
    ["Спасибо, что ждёте", "Ещё немного", "Продолжаю", "Сегодня дольше обычного", "Потерпите немножко"],
    ["Почти готово", "Вот-вот", "Уже заканчиваю", "Финальные штрихи", "Почти у цели"],
    ["Ещё секунда", "Совсем близко", "Последний рывок", "Вот прямо сейчас", "Дособираю"],
  ],
  uk: [
    ["Секундочку", "Хвилинку", "Зараз буде", "Одну секунду", "Уже починаю"],
    ["Я тут", "Взявся", "Працюю", "Уже в процесі", "Помчали"],
    ["Ще чаклую", "Ще думаю", "Копаю", "Не перемикайтеся", "Тримайтеся"],
    ["Дякую, що чекаєте", "Ще трохи", "Продовжую", "Сьогодні довше, ніж зазвичай", "Потерпіть трішки"],
    ["Майже готово", "Ось-ось", "Уже завершую", "Останні штрихи", "Майже біля мети"],
    ["Ще секунда", "Зовсім близько", "Останній ривок", "Просто зараз", "Дозбираю"],
  ],
  cs: [
    ["Vteřinku", "Momentík", "Hned to bude", "Jednu vteřinu", "Už začínám"],
    ["Jsem tu", "Pustil jsem se do toho", "Pracuju na tom", "Už to běží", "Jedeme"],
    ["Ještě na tom dělám", "Pořád přemýšlím", "Hrabu se v tom", "Nikam neodcházej", "Vydrž"],
    ["Díky za trpělivost", "Ještě chvilku", "Pokračuju", "Dneska to trvá dýl", "Vydrž ještě kousek"],
    ["Už to skoro je", "Za chviličku", "Už to dokončuju", "Poslední úpravy", "Skoro u cíle"],
    ["Ještě vteřinku", "Úplně blízko", "Poslední kousek", "Právě teď", "Dodělávám"],
  ],
  de: [
    ["Moment mal", "Sekunde", "Einen Augenblick", "Eine Sekunde noch", "Geht gleich los"],
    ["Bin da", "Hab's angefangen", "Arbeite dran", "Läuft schon", "Los geht's"],
    ["Bin noch dran", "Denke noch", "Grabe mich rein", "Nicht weggehen", "Halt durch"],
    ["Danke fürs Warten", "Noch ein bisschen", "Mache weiter", "Dauert heute länger als sonst", "Halt noch kurz durch"],
    ["Fast fertig", "Gleich so weit", "Schließe gerade ab", "Letzter Schliff", "Fast am Ziel"],
    ["Noch eine Sekunde", "Ganz nah dran", "Letztes Stück", "Jetzt gleich", "Mache den Rest"],
  ],
  fr: [
    ["Juste une seconde", "Deux secondes", "Un instant", "Un petit moment", "Ça démarre"],
    ["Je suis là", "C'est parti", "J'y travaille", "En cours", "On y va"],
    ["J'y suis encore", "Je réfléchis encore", "Je creuse", "Ne pars pas", "Tiens bon"],
    ["Merci de patienter", "Encore un peu", "Je continue", "Plus long que d'habitude", "Tiens encore un peu"],
    ["Presque fini", "Plus qu'un instant", "Je termine", "Dernières retouches", "Presque au but"],
    ["Encore une seconde", "Tout près", "Dernière ligne droite", "Là, maintenant", "Je boucle"],
  ],
  es: [
    ["Un segundito", "Dame un momento", "Ahora mismo", "Un segundo", "Ya empiezo"],
    ["Aquí estoy", "Ya me puse", "Estoy en ello", "En marcha", "Vamos allá"],
    ["Sigo en ello", "Todavía dándole", "Buceando en esto", "No te vayas", "Aguanta"],
    ["Gracias por esperar", "Un poquito más", "Sigo", "Hoy va más lento de lo normal", "Aguanta un poco más"],
    ["Casi listo", "Ya mismo", "Ya termino", "Últimos retoques", "Casi en la meta"],
    ["Un segundo más", "Muy cerca", "Recta final", "Ahora sí", "Cerrando"],
  ],
  it: [
    ["Un attimo", "Un secondo", "Arrivo", "Un momentino", "Parto subito"],
    ["Sono qui", "Mi ci sono messo", "Ci sto lavorando", "In corso", "Andiamo"],
    ["Ci sto ancora", "Sto ancora pensando", "Sto scavando", "Non andare via", "Tieni duro"],
    ["Grazie per l'attesa", "Ancora un po'", "Continuo", "Oggi ci vuole più del solito", "Resisti ancora un po'"],
    ["Quasi fatto", "Ci siamo quasi", "Sto finendo", "Ultimi ritocchi", "Quasi al traguardo"],
    ["Ancora un secondo", "Vicinissimo", "Rettilineo finale", "Proprio ora", "Chiudo"],
  ],
  pt: [
    ["Um segundinho", "Só um instante", "Já vai", "Um segundo", "Já começo"],
    ["Estou aqui", "Já comecei", "A trabalhar nisso", "Em curso", "Vamos lá"],
    ["Ainda cá ando", "Ainda a pensar", "A escavar isto", "Não saias", "Aguenta"],
    ["Obrigado pela espera", "Mais um bocadinho", "Continuo", "Hoje está mais demorado", "Aguenta mais um pouco"],
    ["Quase pronto", "Falta pouco", "Já estou a terminar", "Últimos retoques", "Quase na meta"],
    ["Mais um segundo", "Muito perto", "Reta final", "É agora", "A fechar"],
  ],
  pl: [
    ["Sekundka", "Momencik", "Zaraz będzie", "Jedna sekunda", "Już zaczynam"],
    ["Jestem", "Zabrałem się", "Pracuję nad tym", "W toku", "Jedziemy"],
    ["Jeszcze działam", "Wciąż myślę", "Kopię w tym", "Nie uciekaj", "Wytrzymaj"],
    [
      "Dzięki za cierpliwość",
      "Jeszcze chwilkę",
      "Kontynuuję",
      "Dziś idzie dłużej niż zwykle",
      "Wytrzymaj jeszcze trochę",
    ],
    ["Już prawie", "Zaraz kończę", "Właśnie kończę", "Ostatnie poprawki", "Prawie na mecie"],
    ["Jeszcze sekunda", "Bardzo blisko", "Ostatnia prosta", "Już teraz", "Domykam"],
  ],
  kk: [
    ["Бір секунд", "Сәл күте тұрыңыз", "Қазір болады", "Бір сәт", "Бастадым"],
    ["Мен осындамын", "Кірістім", "Жұмыс істеп жатырмын", "Үдеріс жүріп жатыр", "Кеттік"],
    ["Әлі істеп жатырмын", "Әлі ойланудамын", "Тереңдеп жатырмын", "Кетіп қалмаңыз", "Шыдай тұрыңыз"],
    ["Күткеніңізге рахмет", "Тағы сәл", "Жалғастырамын", "Бүгін әдеттегіден ұзағырақ", "Тағы біраз шыдаңыз"],
    ["Дайын болып қалды", "Азғана қалды", "Аяқтап жатырмын", "Соңғы түзетулер", "Мәреге жақындадым"],
    ["Тағы бір секунд", "Өте жақын", "Соңғы қадам", "Дәл қазір", "Міне-міне"],
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
    (WAIT_PHRASES[langCode] ?? []).flatMap((_, stage) => loaderTextsFor(kind, langCode, stage)),
  );
}
