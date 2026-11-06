/** What kind of phrase to ask for. Wording is fed to the model verbatim. */
export const EXPRESSION_CATEGORIES = [
  "a memorable line from a well-known film",
  "a memorable line from a popular TV series",
  "a quote from a well-known book",
  "a vivid literary simile or metaphor",
  "a witty comparison with a famous person (an actor, athlete, scientist or historical figure)",
  "an idiom that native speakers use every day",
  "a proverb or folk saying",
  "a pop-culture reference people drop into conversation, the way Ted Lasso does",
  "a famous historical phrase or catchphrase",
  "a sports metaphor used outside sport",
  "a line from a famous song that became a saying",
  "an elegant word or turn of phrase that makes speech sound educated",
] as const;

const THEMES = [
  "courage",
  "failure and getting back up",
  "love",
  "friendship",
  "work and ambition",
  "money",
  "time",
  "anger and calm",
  "luck",
  "lies and truth",
  "stupidity and wisdom",
  "change",
  "family",
  "food",
  "weather and mood",
  "success",
  "fear",
  "boredom",
  "teamwork",
  "hope",
] as const;

const TONES = ["playful", "elegant", "ironic", "warm", "sharp", "philosophical"] as const;

export interface ExpressionAngle {
  /** ISO code of the language the expression is in. */
  lang: string;
  category: string;
  theme: string;
  tone: string;
}

/**
 * mulberry32 — seeded rather than `Math.random`, so each notification slot gets
 * its own angle (variety across slots) and a test can pin the angle by its seed.
 */
function seededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], next: () => number): T {
  return items[Math.floor(next() * items.length)] as T;
}

/** Seed for one notification slot: same user, UTC day and UTC hour → same seed. */
export function expressionSeed(userId: number, date: Date, hour: number): number {
  const day = Math.floor(date.getTime() / 86_400_000);
  return (Math.imul(userId, 0x9e3779b1) ^ Math.imul(day, 0x85ebca6b) ^ Math.imul(hour + 1, 0xc2b2ae35)) | 0;
}

/**
 * The random angle replaces a database de-dup lookup: a fresh combination of
 * language × category × theme × tone per slot keeps answers varied without
 * reading what was sent before.
 */
export function pickExpressionAngle(seed: number, langs: readonly string[]): ExpressionAngle {
  const next = seededRandom(seed);
  return {
    lang: langs.length > 0 ? pick(langs, next) : "en",
    category: pick(EXPRESSION_CATEGORIES, next),
    theme: pick(THEMES, next),
    tone: pick(TONES, next),
  };
}
