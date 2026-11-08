export const MAX_DICTIONARY_NAME_LENGTH = 32;

/**
 * The name a new or renamed dictionary gets, or null when it is empty, too long, or
 * already taken (case-insensitively) by another of the learner's dictionaries.
 * `normalized` is the repository's `normalizeName` output, the form it stores.
 */
export function acceptDictionaryName(
  normalized: string,
  dictionaries: readonly { id: number; name: string }[],
  currentDictionaryId?: number,
): string | null {
  if (normalized.length === 0 || normalized.length > MAX_DICTIONARY_NAME_LENGTH) return null;
  const lower = normalized.toLowerCase();
  const duplicate = dictionaries.some(
    (dictionary) => dictionary.id !== currentDictionaryId && dictionary.name.toLowerCase() === lower,
  );
  return duplicate ? null : normalized;
}
