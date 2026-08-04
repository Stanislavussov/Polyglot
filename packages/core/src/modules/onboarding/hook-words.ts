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
 * Three curated headwords per supported learning language, keyed by ISO 639-1
 * code. Covers all 11 supported languages (en, ru, cs, de, fr, es, it, pt, uk,
 * pl, kk) — the same set the interface locales cover.
 */
export const HOOK_WORDS: Readonly<Record<string, readonly HookWord[]>> = {
  // English — an abstract noun most languages paraphrase, the canonical
  // "tea" idiom from the spec, and a phrasal verb whose parts mean nothing
  // on their own (the single biggest stumbling block for learners).
  en: [
    { headword: "serendipity", category: "untranslatable" },
    { headword: "it's not my cup of tea", category: "idiom" },
    { headword: "put up with", category: "quirk" },
  ],

  // Russian — the textbook untranslatable noun, a vivid idiom whose literal
  // reading ("to split wooden blocks") says nothing about idling, and the
  // all-purpose particle that means "let's", "come on" and "bye" at once.
  ru: [
    { headword: "тоска", category: "untranslatable" },
    { headword: "бить баклуши", category: "idiom" },
    { headword: "давай", category: "quirk" },
  ],

  // Czech — the spec's own examples: a verb for a whole social protocol
  // (ring once and hang up so the other person calls back), the vowel-less
  // tongue twister that shows Czech syllabic consonants, plus an idiom whose
  // literal reading ("to walk around hot porridge") hides "beat about the bush".
  cs: [
    { headword: "prozvonit", category: "untranslatable" },
    { headword: "chodit kolem horké kaše", category: "idiom" },
    { headword: "strč prst skrz krk", category: "quirk" },
  ],

  // German — the spec's three: a compound noun for "a face badly in need of a
  // slap", the verb for making something worse by trying to improve it, and
  // the modal particle that contradicts a negative and has no English word.
  de: [
    { headword: "Backpfeifengesicht", category: "untranslatable" },
    { headword: "verschlimmbessern", category: "untranslatable" },
    { headword: "doch", category: "quirk" },
  ],

  // French — the feeling of being out of your own element, the spec's
  // "to have the cockroach" idiom, and `si`, the second "yes" reserved for
  // contradicting a negative question (the French counterpart of `doch`).
  fr: [
    { headword: "dépaysement", category: "untranslatable" },
    { headword: "avoir le cafard", category: "idiom" },
    { headword: "si", category: "quirk" },
  ],

  // Spanish — the spec's `sobremesa` (the conversation that outlives the meal),
  // an idiom that literally reads "to be eaten bread", and a verb that packs
  // "to use or wear something for the very first time" into one word.
  es: [
    { headword: "sobremesa", category: "untranslatable" },
    { headword: "ser pan comido", category: "idiom" },
    { headword: "estrenar", category: "quirk" },
  ],

  // Italian — the post-lunch drowsiness that has no one-word equivalent, the
  // good-luck wish that literally sends you "into the wolf's mouth", and the
  // particle that swings between "maybe", "if only" and "I wish".
  it: [
    { headword: "abbiocco", category: "untranslatable" },
    { headword: "in bocca al lupo", category: "idiom" },
    { headword: "magari", category: "quirk" },
  ],

  // Portuguese — the canonical untranslatable noun, an idiom that literally
  // reads "to swallow frogs", and a diminutive that names a whole social
  // ritual rather than a small coffee.
  pt: [
    { headword: "saudade", category: "untranslatable" },
    { headword: "engolir sapos", category: "idiom" },
    { headword: "cafezinho", category: "quirk" },
  ],

  // Ukrainian — the warm land birds fly to for the winter (one noun, no
  // equivalent), an idiom measuring quantity by "as much as a cat cried",
  // and an old adverb of admiration that no interface language renders in
  // one word.
  uk: [
    { headword: "вирій", category: "untranslatable" },
    { headword: "як кіт наплакав", category: "idiom" },
    { headword: "нівроку", category: "quirk" },
  ],

  // Polish — the verb for improvising a way around a problem, an idiom that
  // literally reads "a roll with butter", and `no`, which is a relaxed "yeah"
  // and the most useful false friend in the language.
  pl: [
    { headword: "kombinować", category: "untranslatable" },
    { headword: "bułka z masłem", category: "idiom" },
    { headword: "no", category: "quirk" },
  ],

  // Kazakh — the spread table that stands for hospitality itself, an idiom of
  // joy that literally reads "his crown reached the sky", and the standard
  // polite greeting that literally asks "are you healthy?" and carries the
  // question particle every learner meets first.
  kk: [
    { headword: "дастархан", category: "untranslatable" },
    { headword: "төбесі көкке жетті", category: "idiom" },
    { headword: "сәлеметсіз бе", category: "quirk" },
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
