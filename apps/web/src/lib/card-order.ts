// A card reads native translation → meaning → the other languages.
export function splitNative<T extends { lang: string }>(
  items: T[],
  nativeLang: string | undefined,
): { native: T | null; others: T[] } {
  const native = (nativeLang && items.find((item) => item.lang === nativeLang)) || null;
  return { native, others: native ? items.filter((item) => item !== native) : items };
}

// A word typed in the native language has no native translation: its answer is the language being learned.
export function splitAnswer<T extends { lang: string }>(
  items: T[],
  nativeLang: string | undefined,
  learningLangs: readonly string[] | undefined,
): { answer: T[]; rest: T[] } {
  const { native, others } = splitNative(items, nativeLang);
  if (native) return { answer: [native], rest: others };
  const learning = (learningLangs ?? []).flatMap((lang) => items.filter((item) => item.lang === lang));
  if (learning.length === 0) return { answer: items, rest: [] };
  return { answer: learning, rest: items.filter((item) => !learning.includes(item)) };
}
