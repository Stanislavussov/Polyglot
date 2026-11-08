// A card reads native translation → meaning → the other languages.
export function splitNative<T extends { lang: string }>(
  items: T[],
  nativeLang: string | undefined,
): { native: T | null; others: T[] } {
  const native = (nativeLang && items.find((item) => item.lang === nativeLang)) || null;
  return { native, others: native ? items.filter((item) => item !== native) : items };
}
