const ANYTIME = ["web.translate.greet.what", "web.translate.greet.newWord", "web.translate.greet.heard"] as const;
const BY_PART_OF_DAY = {
  morning: ["web.translate.greet.morning", "web.translate.greet.coffee"],
  day: [],
  evening: ["web.translate.greet.evening", "web.translate.greet.beforeBed"],
  night: ["web.translate.greet.moonlit"],
} as const;

export type GreetingKey = (typeof ANYTIME)[number] | (typeof BY_PART_OF_DAY)[keyof typeof BY_PART_OF_DAY][number];

function partOfDay(hour: number): keyof typeof BY_PART_OF_DAY {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "day";
  if (hour >= 18 && hour < 23) return "evening";
  return "night";
}

/** The phrases that fit the learner's local hour: the anytime ones plus those for this part of the day. */
export function greetingsFor(hour: number): GreetingKey[] {
  return [...ANYTIME, ...BY_PART_OF_DAY[partOfDay(hour)]];
}

/** `random` in [0, 1), as Math.random returns. */
export function pickGreeting(hour: number, random: number): GreetingKey {
  const options = greetingsFor(hour);
  return options[Math.min(options.length - 1, Math.floor(random * options.length))] ?? ANYTIME[0];
}
