/**
 * Onboarding hook words (Task 72, slice 4).
 *
 * The curated headword list is the SOURCE OF TRUTH for the onboarding demo:
 * `onboarding_demo_cards` only caches the rendered card per native language.
 *
 * Each learning language gets exactly three headwords chosen to demonstrate
 * what a plain dictionary cannot do:
 *
 * - `untranslatable` — a concept the interface language has no word for, so the
 *   card has to explain rather than translate.
 * - `idiom` — literal translation breaks; the card has to give the equivalent.
 * - `quirk` — a feature of the language itself (a particle, a construction, a
 *   sound pattern) that shows real command of it.
 *
 * Curation constraints (from the task spec): no vulgarity, no politics, no
 * culturally loaded jokes, and the point must survive translation into every
 * one of the 11 interface languages. Every generated card is still reviewed
 * once (`is_active`) before it is ever served.
 */

/** What a hook word is meant to demonstrate. */
export type HookWordCategory = "untranslatable" | "idiom" | "quirk";

export interface HookWord {
  headword: string;
  category: HookWordCategory;
}

/**
 * Thirty curated headwords per supported learning language, keyed by ISO 639-1
 * code. Covers all 11 supported languages (en, ru, cs, de, fr, es, it, pt, uk,
 * pl, kk) — the same set the interface locales cover.
 *
 * The first three of each list are the original onboarding demo picks and MUST
 * keep their positions: `onb:hook:<lang>:<index>` callbacks and cached demo
 * cards address a word by its index, so reordering them would repoint live
 * buttons at different words. Append new words, never insert.
 *
 * The list is thirty long because it doubles as the re-engagement notification
 * fallback (see the preset layer in @polyglot/adapter-notifications): a user
 * with an empty dictionary should be able to receive one a day for a month
 * without ever seeing a repeat.
 */
export const HOOK_WORDS: Readonly<Record<string, readonly HookWord[]>> = {
  // English — an abstract noun most languages paraphrase, the canonical
  // "tea" idiom from the spec, and a phrasal verb whose parts mean nothing
  // on their own (the single biggest stumbling block for learners).
  en: [
    { headword: "serendipity", category: "untranslatable" },
    { headword: "it's not my cup of tea", category: "idiom" },
    { headword: "put up with", category: "quirk" },
    { headword: "sibling", category: "untranslatable" },
    { headword: "awkward", category: "untranslatable" },
    { headword: "cozy", category: "untranslatable" },
    { headword: "overwhelmed", category: "untranslatable" },
    { headword: "small talk", category: "untranslatable" },
    { headword: "pet peeve", category: "untranslatable" },
    { headword: "wishful thinking", category: "untranslatable" },
    { headword: "commute", category: "untranslatable" },
    { headword: "break the ice", category: "idiom" },
    { headword: "hit the nail on the head", category: "idiom" },
    { headword: "once in a blue moon", category: "idiom" },
    { headword: "the last straw", category: "idiom" },
    { headword: "under the weather", category: "idiom" },
    { headword: "cost an arm and a leg", category: "idiom" },
    { headword: "spill the beans", category: "idiom" },
    { headword: "a piece of cake", category: "idiom" },
    { headword: "beat around the bush", category: "idiom" },
    { headword: "get cold feet", category: "idiom" },
    { headword: "call it a day", category: "idiom" },
    { headword: "on the same page", category: "idiom" },
    { headword: "get over", category: "quirk" },
    { headword: "look forward to", category: "quirk" },
    { headword: "run out of", category: "quirk" },
    { headword: "come up with", category: "quirk" },
    { headword: "put off", category: "quirk" },
    { headword: "take after", category: "quirk" },
    { headword: "used to", category: "quirk" },
  ],

  // Russian — the textbook untranslatable noun, a vivid idiom whose literal
  // reading ("to split wooden blocks") says nothing about idling, and the
  // all-purpose particle that means "let's", "come on" and "bye" at once.
  ru: [
    { headword: "тоска", category: "untranslatable" },
    { headword: "бить баклуши", category: "idiom" },
    { headword: "давай", category: "quirk" },
    { headword: "авось", category: "untranslatable" },
    { headword: "пошлость", category: "untranslatable" },
    { headword: "хамство", category: "untranslatable" },
    { headword: "уют", category: "untranslatable" },
    { headword: "успеть", category: "untranslatable" },
    { headword: "разлука", category: "untranslatable" },
    { headword: "заодно", category: "untranslatable" },
    { headword: "однолюб", category: "untranslatable" },
    { headword: "водить за нос", category: "idiom" },
    { headword: "как две капли воды", category: "idiom" },
    { headword: "спустя рукава", category: "idiom" },
    { headword: "не в своей тарелке", category: "idiom" },
    { headword: "зарубить на носу", category: "idiom" },
    { headword: "делать из мухи слона", category: "idiom" },
    { headword: "остаться с носом", category: "idiom" },
    { headword: "душа в душу", category: "idiom" },
    { headword: "рукой подать", category: "idiom" },
    { headword: "как снег на голову", category: "idiom" },
    { headword: "бросать слова на ветер", category: "idiom" },
    { headword: "считать ворон", category: "idiom" },
    { headword: "ну", category: "quirk" },
    { headword: "же", category: "quirk" },
    { headword: "ничего", category: "quirk" },
    { headword: "ага", category: "quirk" },
    { headword: "мол", category: "quirk" },
    { headword: "разве", category: "quirk" },
    { headword: "вроде", category: "quirk" },
  ],

  // Czech — the spec's own examples: a verb for a whole social protocol
  // (ring once and hang up so the other person calls back), the vowel-less
  // tongue twister that shows Czech syllabic consonants, plus an idiom whose
  // literal reading ("to walk around hot porridge") hides "beat about the bush".
  cs: [
    { headword: "prozvonit", category: "untranslatable" },
    { headword: "chodit kolem horké kaše", category: "idiom" },
    { headword: "strč prst skrz krk", category: "quirk" },
    { headword: "litost", category: "untranslatable" },
    { headword: "pohoda", category: "untranslatable" },
    { headword: "šikovný", category: "untranslatable" },
    { headword: "stihnout", category: "untranslatable" },
    { headword: "předevčírem", category: "untranslatable" },
    { headword: "pohodář", category: "untranslatable" },
    { headword: "ponorka", category: "untranslatable" },
    { headword: "blbnout", category: "untranslatable" },
    { headword: "mít se jako prase v žitě", category: "idiom" },
    { headword: "být v sedmém nebi", category: "idiom" },
    { headword: "dělat z komára velblouda", category: "idiom" },
    { headword: "mít máslo na hlavě", category: "idiom" },
    { headword: "padají trakaře", category: "idiom" },
    { headword: "mluvit do zdi", category: "idiom" },
    { headword: "mít kliku", category: "idiom" },
    { headword: "být v balíku", category: "idiom" },
    { headword: "držet palce", category: "idiom" },
    { headword: "je to za pět minut dvanáct", category: "idiom" },
    { headword: "ani ryba ani rak", category: "idiom" },
    { headword: "hodit flintu do žita", category: "idiom" },
    { headword: "no", category: "quirk" },
    { headword: "jo", category: "quirk" },
    { headword: "prostě", category: "quirk" },
    { headword: "vlastně", category: "quirk" },
    { headword: "aspoň", category: "quirk" },
    { headword: "spíš", category: "quirk" },
    { headword: "copak", category: "quirk" },
  ],

  // German — the spec's three: a compound noun for "a face badly in need of a
  // slap", the verb for making something worse by trying to improve it, and
  // the modal particle that contradicts a negative and has no English word.
  de: [
    { headword: "Backpfeifengesicht", category: "untranslatable" },
    { headword: "verschlimmbessern", category: "untranslatable" },
    { headword: "doch", category: "quirk" },
    { headword: "Fernweh", category: "untranslatable" },
    { headword: "Schadenfreude", category: "untranslatable" },
    { headword: "Torschlusspanik", category: "untranslatable" },
    { headword: "Kummerspeck", category: "untranslatable" },
    { headword: "Fingerspitzengefühl", category: "untranslatable" },
    { headword: "Weltschmerz", category: "untranslatable" },
    { headword: "Feierabend", category: "untranslatable" },
    { headword: "Geborgenheit", category: "untranslatable" },
    { headword: "Gemütlichkeit", category: "untranslatable" },
    { headword: "Ohrwurm", category: "untranslatable" },
    { headword: "Vorfreude", category: "untranslatable" },
    { headword: "Treppenwitz", category: "untranslatable" },
    { headword: "die Daumen drücken", category: "idiom" },
    { headword: "ins Fettnäpfchen treten", category: "idiom" },
    { headword: "Tomaten auf den Augen haben", category: "idiom" },
    { headword: "das ist mir Wurst", category: "idiom" },
    { headword: "die Nase voll haben", category: "idiom" },
    { headword: "unter vier Augen", category: "idiom" },
    { headword: "nur Bahnhof verstehen", category: "idiom" },
    { headword: "aus dem Häuschen sein", category: "idiom" },
    { headword: "mal", category: "quirk" },
    { headword: "eben", category: "quirk" },
    { headword: "halt", category: "quirk" },
    { headword: "schon", category: "quirk" },
    { headword: "wohl", category: "quirk" },
    { headword: "denn", category: "quirk" },
    { headword: "ja", category: "quirk" },
  ],

  // French — the feeling of being out of your own element, the spec's
  // "to have the cockroach" idiom, and `si`, the second "yes" reserved for
  // contradicting a negative question (the French counterpart of `doch`).
  fr: [
    { headword: "dépaysement", category: "untranslatable" },
    { headword: "avoir le cafard", category: "idiom" },
    { headword: "si", category: "quirk" },
    { headword: "flâner", category: "untranslatable" },
    { headword: "râler", category: "untranslatable" },
    { headword: "l'esprit de l'escalier", category: "untranslatable" },
    { headword: "retrouvailles", category: "untranslatable" },
    { headword: "terroir", category: "untranslatable" },
    { headword: "empêchement", category: "untranslatable" },
    { headword: "avant-hier", category: "untranslatable" },
    { headword: "bof", category: "untranslatable" },
    { headword: "poser un lapin", category: "idiom" },
    { headword: "coup de foudre", category: "idiom" },
    { headword: "avoir un chat dans la gorge", category: "idiom" },
    { headword: "tomber dans les pommes", category: "idiom" },
    { headword: "revenons à nos moutons", category: "idiom" },
    { headword: "il pleut des cordes", category: "idiom" },
    { headword: "mettre son grain de sel", category: "idiom" },
    { headword: "avoir le coup de main", category: "idiom" },
    { headword: "donner sa langue au chat", category: "idiom" },
    { headword: "être à côté de la plaque", category: "idiom" },
    { headword: "poser une colle", category: "idiom" },
    { headword: "avoir le cœur sur la main", category: "idiom" },
    { headword: "quand même", category: "quirk" },
    { headword: "du coup", category: "quirk" },
    { headword: "enfin", category: "quirk" },
    { headword: "hein", category: "quirk" },
    { headword: "on", category: "quirk" },
    { headword: "y", category: "quirk" },
    { headword: "en", category: "quirk" },
  ],

  // Spanish — the spec's `sobremesa` (the conversation that outlives the meal),
  // an idiom that literally reads "to be eaten bread", and a verb that packs
  // "to use or wear something for the very first time" into one word.
  es: [
    { headword: "sobremesa", category: "untranslatable" },
    { headword: "ser pan comido", category: "idiom" },
    { headword: "estrenar", category: "quirk" },
    { headword: "friolero", category: "untranslatable" },
    { headword: "anteayer", category: "untranslatable" },
    { headword: "tocayo", category: "untranslatable" },
    { headword: "madrugar", category: "untranslatable" },
    { headword: "empalagar", category: "untranslatable" },
    { headword: "desvelarse", category: "untranslatable" },
    { headword: "puente", category: "untranslatable" },
    { headword: "merienda", category: "untranslatable" },
    { headword: "vergüenza ajena", category: "untranslatable" },
    { headword: "trasnochar", category: "untranslatable" },
    { headword: "estar en las nubes", category: "idiom" },
    { headword: "tomar el pelo", category: "idiom" },
    { headword: "no tener pelos en la lengua", category: "idiom" },
    { headword: "echar una mano", category: "idiom" },
    { headword: "meter la pata", category: "idiom" },
    { headword: "ponerse las pilas", category: "idiom" },
    { headword: "costar un ojo de la cara", category: "idiom" },
    { headword: "dar en el clavo", category: "idiom" },
    { headword: "estar como una cabra", category: "idiom" },
    { headword: "ir al grano", category: "idiom" },
    { headword: "ojalá", category: "quirk" },
    { headword: "pues", category: "quirk" },
    { headword: "vale", category: "quirk" },
    { headword: "ya", category: "quirk" },
    { headword: "venga", category: "quirk" },
    { headword: "hombre", category: "quirk" },
    { headword: "que", category: "quirk" },
  ],

  // Italian — the post-lunch drowsiness that has no one-word equivalent, the
  // good-luck wish that literally sends you "into the wolf's mouth", and the
  // particle that swings between "maybe", "if only" and "I wish".
  it: [
    { headword: "abbiocco", category: "untranslatable" },
    { headword: "in bocca al lupo", category: "idiom" },
    { headword: "magari", category: "quirk" },
    { headword: "meriggiare", category: "untranslatable" },
    { headword: "gattara", category: "untranslatable" },
    { headword: "menefreghista", category: "untranslatable" },
    { headword: "culaccino", category: "untranslatable" },
    { headword: "apericena", category: "untranslatable" },
    { headword: "struggimento", category: "untranslatable" },
    { headword: "pantofolaio", category: "untranslatable" },
    { headword: "l'altroieri", category: "untranslatable" },
    { headword: "non vedo l'ora", category: "idiom" },
    { headword: "essere al verde", category: "idiom" },
    { headword: "prendere due piccioni con una fava", category: "idiom" },
    { headword: "avere le mani in pasta", category: "idiom" },
    { headword: "acqua in bocca", category: "idiom" },
    { headword: "che pizza", category: "idiom" },
    { headword: "fare il portoghese", category: "idiom" },
    { headword: "cadere dalle nuvole", category: "idiom" },
    { headword: "avere la testa fra le nuvole", category: "idiom" },
    { headword: "fare orecchie da mercante", category: "idiom" },
    { headword: "essere in gamba", category: "idiom" },
    { headword: "tirare il pacco", category: "idiom" },
    { headword: "ci", category: "quirk" },
    { headword: "ne", category: "quirk" },
    { headword: "mica", category: "quirk" },
    { headword: "allora", category: "quirk" },
    { headword: "dai", category: "quirk" },
    { headword: "beh", category: "quirk" },
    { headword: "proprio", category: "quirk" },
  ],

  // Portuguese — the canonical untranslatable noun, an idiom that literally
  // reads "to swallow frogs", and a diminutive that names a whole social
  // ritual rather than a small coffee.
  pt: [
    { headword: "saudade", category: "untranslatable" },
    { headword: "engolir sapos", category: "idiom" },
    { headword: "cafezinho", category: "quirk" },
    { headword: "cafuné", category: "untranslatable" },
    { headword: "desenrascanço", category: "untranslatable" },
    { headword: "xodó", category: "untranslatable" },
    { headword: "friorento", category: "untranslatable" },
    { headword: "anteontem", category: "untranslatable" },
    { headword: "madrugar", category: "untranslatable" },
    { headword: "calorento", category: "untranslatable" },
    { headword: "malandro", category: "untranslatable" },
    { headword: "pagar o pato", category: "idiom" },
    { headword: "chutar o balde", category: "idiom" },
    { headword: "ficar de molho", category: "idiom" },
    { headword: "dar com os burros n'água", category: "idiom" },
    { headword: "encher linguiça", category: "idiom" },
    { headword: "tirar o cavalinho da chuva", category: "idiom" },
    { headword: "matar dois coelhos com uma cajadada", category: "idiom" },
    { headword: "fazer vista grossa", category: "idiom" },
    { headword: "estar com a pulga atrás da orelha", category: "idiom" },
    { headword: "dar um jeitinho", category: "idiom" },
    { headword: "nem que a vaca tussa", category: "idiom" },
    { headword: "viajar na maionese", category: "idiom" },
    { headword: "pois é", category: "quirk" },
    { headword: "né", category: "quirk" },
    { headword: "então", category: "quirk" },
    { headword: "cadê", category: "quirk" },
    { headword: "mesmo", category: "quirk" },
    { headword: "ficar", category: "quirk" },
    { headword: "tomara", category: "quirk" },
  ],

  // Ukrainian — the warm land birds fly to for the winter (one noun, no
  // equivalent), an idiom measuring quantity by "as much as a cat cried",
  // and an old adverb of admiration that no interface language renders in
  // one word.
  uk: [
    { headword: "вирій", category: "untranslatable" },
    { headword: "як кіт наплакав", category: "idiom" },
    { headword: "нівроку", category: "quirk" },
    { headword: "затишок", category: "untranslatable" },
    { headword: "щирість", category: "untranslatable" },
    { headword: "домівка", category: "untranslatable" },
    { headword: "розрада", category: "untranslatable" },
    { headword: "позавчора", category: "untranslatable" },
    { headword: "досвітки", category: "untranslatable" },
    { headword: "обійми", category: "untranslatable" },
    { headword: "наснага", category: "untranslatable" },
    { headword: "лізти поперед батька в пекло", category: "idiom" },
    { headword: "дати гарбуза", category: "idiom" },
    { headword: "бити байдики", category: "idiom" },
    { headword: "тримати кулаки", category: "idiom" },
    { headword: "робити з мухи слона", category: "idiom" },
    { headword: "як сніг на голову", category: "idiom" },
    { headword: "ні пуху ні пера", category: "idiom" },
    { headword: "водити за носа", category: "idiom" },
    { headword: "рукою подати", category: "idiom" },
    { headword: "пекти раків", category: "idiom" },
    { headword: "брати близько до серця", category: "idiom" },
    { headword: "теревені правити", category: "idiom" },
    { headword: "ну", category: "quirk" },
    { headword: "ж", category: "quirk" },
    { headword: "хіба", category: "quirk" },
    { headword: "аж", category: "quirk" },
    { headword: "мабуть", category: "quirk" },
    { headword: "нехай", category: "quirk" },
    { headword: "ото", category: "quirk" },
  ],

  // Polish — the verb for improvising a way around a problem, an idiom that
  // literally reads "a roll with butter", and `no`, which is a relaxed "yeah"
  // and the most useful false friend in the language.
  pl: [
    { headword: "kombinować", category: "untranslatable" },
    { headword: "bułka z masłem", category: "idiom" },
    { headword: "no", category: "quirk" },
    { headword: "załatwić", category: "untranslatable" },
    { headword: "dobranocka", category: "untranslatable" },
    { headword: "smacznego", category: "untranslatable" },
    { headword: "przedwczoraj", category: "untranslatable" },
    { headword: "doba", category: "untranslatable" },
    { headword: "tęsknota", category: "untranslatable" },
    { headword: "kwadrans", category: "untranslatable" },
    { headword: "pogodny", category: "untranslatable" },
    { headword: "rzucać grochem o ścianę", category: "idiom" },
    { headword: "być nie w sosie", category: "idiom" },
    { headword: "mieć muchy w nosie", category: "idiom" },
    { headword: "trzymać kciuki", category: "idiom" },
    { headword: "wiercić dziurę w brzuchu", category: "idiom" },
    { headword: "raz na ruski rok", category: "idiom" },
    { headword: "co ma piernik do wiatraka", category: "idiom" },
    { headword: "robić z igły widły", category: "idiom" },
    { headword: "czuć się jak ryba w wodzie", category: "idiom" },
    { headword: "spaść z księżyca", category: "idiom" },
    { headword: "mieć węża w kieszeni", category: "idiom" },
    { headword: "poszło jak z płatka", category: "idiom" },
    { headword: "przecież", category: "quirk" },
    { headword: "właśnie", category: "quirk" },
    { headword: "chyba", category: "quirk" },
    { headword: "aż", category: "quirk" },
    { headword: "trochę", category: "quirk" },
    { headword: "też", category: "quirk" },
    { headword: "no dobra", category: "quirk" },
  ],

  // Kazakh — the spread table that stands for hospitality itself, an idiom of
  // joy that literally reads "his crown reached the sky", and the standard
  // polite greeting that literally asks "are you healthy?" and carries the
  // question particle every learner meets first.
  kk: [
    { headword: "дастархан", category: "untranslatable" },
    { headword: "төбесі көкке жетті", category: "idiom" },
    { headword: "сәлеметсіз бе", category: "quirk" },
    { headword: "қонақжайлылық", category: "untranslatable" },
    { headword: "бата", category: "untranslatable" },
    { headword: "шаңырақ", category: "untranslatable" },
    { headword: "сыбаға", category: "untranslatable" },
    { headword: "ерулік", category: "untranslatable" },
    { headword: "тұсаукесер", category: "untranslatable" },
    { headword: "жеті ата", category: "untranslatable" },
    { headword: "ағайын", category: "untranslatable" },
    { headword: "ит арқасы қиянда", category: "idiom" },
    { headword: "аузы-мұрны қисаймай", category: "idiom" },
    { headword: "жүрегі тас төбесіне шықты", category: "idiom" },
    { headword: "қой аузынан шөп алмас", category: "idiom" },
    { headword: "көзі жетті", category: "idiom" },
    { headword: "жаны қалмады", category: "idiom" },
    { headword: "ауыз бірлік", category: "idiom" },
    { headword: "қолы ұзын", category: "idiom" },
    { headword: "төбе шашы тік тұрды", category: "idiom" },
    { headword: "ит өлген жер", category: "idiom" },
    { headword: "екі езуі екі құлағында", category: "idiom" },
    { headword: "бір жағадан бас шығару", category: "idiom" },
    { headword: "ғой", category: "quirk" },
    { headword: "екен", category: "quirk" },
    { headword: "ше", category: "quirk" },
    { headword: "-ақ", category: "quirk" },
    { headword: "әрине", category: "quirk" },
    { headword: "жарайды", category: "quirk" },
    { headword: "әйтеуір", category: "quirk" },
  ],
};

/**
 * Hook words for a learning language. Returns an empty list for a language
 * that has no curated set yet — callers fall back to free-text input, so an
 * unknown code must never throw.
 */
export function getHookWords(lang: string): readonly HookWord[] {
  return HOOK_WORDS[lang] ?? [];
}

/** Every learning language that currently has a curated hook set. */
export function getHookWordLanguages(): readonly string[] {
  return Object.keys(HOOK_WORDS);
}
