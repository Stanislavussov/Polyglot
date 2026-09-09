/**
 * The angles the bot ships with — seeded into `word_picker_presets`, then owned
 * by the admin panel (edit, add, deactivate). Seeding is keyed by `slug`, so a
 * preset an admin has since rewritten is left alone on the next seed run.
 *
 * They are deliberately not a phrasebook. "At the pharmacy" and "at the
 * restaurant" teach a situation; these teach the shape of the language — what it
 * lexicalizes that the learner's own language does not, where it traps them,
 * what its machinery is made of.
 *
 * Titles carry `en`, `ru` and `cs`; any other interface language falls back to
 * `title`. Prompts stay in English — they are read by the model, not the user.
 */

export interface DefaultWordPickerPreset {
  slug: string;
  emoji: string;
  title: string;
  titleI18n: Record<string, string>;
  prompt: string;
  sortOrder: number;
}

export const DEFAULT_WORD_PICKER_PRESETS: readonly DefaultWordPickerPreset[] = [
  {
    slug: "untranslatable",
    emoji: "🕳",
    title: "No word for this at home",
    titleI18n: { ru: "Непереводимое", cs: "Nepřeložitelné" },
    prompt:
      "Pick words that this language lexicalizes as a single unit while the learner's native language needs a whole phrase — or has no way to say it at all. For each one, say what the single word packs in that the paraphrase leaks.",
    sortOrder: 10,
  },
  {
    slug: "false-friends",
    emoji: "🎭",
    title: "False friends",
    titleI18n: { ru: "Ложные друзья", cs: "Falešní přátelé" },
    prompt:
      "Pick words that look or sound like a word in the learner's native language (or in English, if the learner already knows it) but mean something else. Name the wrong meaning the learner will reach for and the real one, and give an example where the confusion actually bites.",
    sortOrder: 20,
  },
  {
    slug: "registers",
    emoji: "🎚",
    title: "One meaning, three registers",
    titleI18n: { ru: "Один смысл, три регистра", cs: "Jeden význam, tři roviny" },
    prompt:
      "Pick items that are the formal, neutral and slang way of saying the same thing, grouped so the learner sees the ladder. In the note, say who says it and where saying it in the wrong room would be a mistake.",
    sortOrder: 30,
  },
  {
    slug: "absurd-idioms",
    emoji: "🐟",
    title: "Idioms that make no literal sense",
    titleI18n: { ru: "Идиомы, абсурдные буквально", cs: "Idiomy, které doslova nedávají smysl" },
    prompt:
      "Pick idioms whose literal reading is absurd or funny. Give the literal picture first, then what it actually means, and — where it is known — where the image came from.",
    sortOrder: 40,
  },
  {
    slug: "word-machinery",
    emoji: "🧩",
    title: "How words are built here",
    titleI18n: { ru: "Как здесь собираются слова", cs: "Jak se tu slova skládají" },
    prompt:
      "Pick words from one productive root, prefix or suffix family so the learner can see the machinery: same stem, different affix, different meaning. In the note, state the rule the family follows, so the learner can predict the next word instead of memorizing it.",
    sortOrder: 50,
  },
  {
    slug: "grammar-you-lack",
    emoji: "⚙️",
    title: "Grammar your language doesn't have",
    titleI18n: { ru: "Грамматика, которой нет у вас", cs: "Gramatika, kterou vaše řeč nemá" },
    prompt:
      "Pick words and short constructions that carry a grammatical distinction the learner's native language does not mark at all — verbal aspect, articles, separable prefixes, cases, evidentiality, animacy, formal/informal address. Show a minimal pair where changing that one thing changes the meaning.",
    sortOrder: 60,
  },
  {
    slug: "unnamed-feelings",
    emoji: "🌫",
    title: "Feelings with no name at home",
    titleI18n: { ru: "Чувства без названия", cs: "Pocity beze jména" },
    prompt:
      "Pick words for emotions, moods and states that the learner's native language has no single word for. Describe the exact situation that word is for — the note should let the learner recognize the feeling before they can pronounce the word.",
    sortOrder: 70,
  },
  {
    slug: "small-words",
    emoji: "🪶",
    title: "Small words that change everything",
    titleI18n: { ru: "Мелкие слова, меняющие всё", cs: "Malá slova, která mění vše" },
    prompt:
      "Pick particles, fillers and discourse markers that natives use constantly and textbooks skip — the ones that shift a sentence from neutral to impatient, softened, ironic or intimate. Give the same sentence with and without the word and say what changed.",
    sortOrder: 80,
  },
  {
    slug: "sounds-and-cries",
    emoji: "📣",
    title: "Sounds, cries and noises",
    titleI18n: { ru: "Звуки, возгласы и шумы", cs: "Zvuky, výkřiky a ruchy" },
    prompt:
      "Pick interjections and onomatopoeia: what this language's animals, doors, phones and pains sound like, and what people shout when startled, disgusted or delighted. Note where the sound differs strikingly from the learner's own language.",
    sortOrder: 90,
  },
  {
    slug: "borrowed-and-twisted",
    emoji: "🔄",
    title: "Borrowed and twisted",
    titleI18n: { ru: "Заимствовано и вывернуто", cs: "Vypůjčeno a překrouceno" },
    prompt:
      "Pick loanwords whose meaning shifted on the way in — false anglicisms, borrowings that narrowed, widened or turned ironic. Give the meaning in the source language and the meaning here, and warn where using the original sense would sound wrong.",
    sortOrder: 100,
  },
  {
    slug: "dates-you",
    emoji: "⏳",
    title: "Words that date you",
    titleI18n: { ru: "Слова, выдающие возраст", cs: "Slova, která vás prozradí" },
    prompt:
      "Pick pairs where an old-fashioned word and the current one mean the same thing, plus words that instantly mark the speaker as young or old. Say which one a learner should actually use today and what the other one signals.",
    sortOrder: 110,
  },
  {
    slug: "polite-knives",
    emoji: "🗡",
    title: "Polite knives",
    titleI18n: { ru: "Вежливые ножи", cs: "Zdvořilé nože" },
    prompt:
      "Pick the phrasings natives use to disagree, refuse, complain or push back while staying formally polite — and the ones that sound polite in translation but land as rude. Say exactly how sharp each one is.",
    sortOrder: 120,
  },
  {
    slug: "shop-talk-it",
    emoji: "🖥",
    title: "IT shop talk",
    titleI18n: { ru: "Как говорят в IT", cs: "Jak se mluví v IT" },
    prompt:
      "Pick the vocabulary software people actually use at work in this language — what gets borrowed from English and what has a native word, the verbs for deploying, reviewing and breaking things, and the jargon of a standup. Note where the textbook term and the office term differ.",
    sortOrder: 130,
  },
  {
    slug: "body-metaphors",
    emoji: "🫀",
    title: "Where feelings live in the body",
    titleI18n: { ru: "Где здесь живут чувства", cs: "Kde tu sídlí pocity" },
    prompt:
      "Pick expressions that locate emotion, thought or character in a body part, and compare that placement with the learner's own language — which organ carries courage, grief, memory, stubbornness here. Note the mismatch when there is one.",
    sortOrder: 140,
  },
] as const;
