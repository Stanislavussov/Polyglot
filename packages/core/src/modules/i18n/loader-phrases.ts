import type { I18nKey } from "./types.js";

/** The two long operations that show a rotating loader. */
export type LoaderKind = "translate" | "mentor";

/**
 * Loader phrases grouped by how long the user has already been waiting: index 0
 * is what appears immediately, each later stage replaces it as the wait drags on.
 *
 * The variants inside a stage are interchangeable — one is drawn at random — so
 * neither a single long wait nor two waits in a row read identically. Telegram
 * rejects an edit that does not change the text, so a picker must never return
 * the phrase already on screen.
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

/** Variants for `stage`, clamped to the last stage once the wait outruns the list. */
export function loaderPhraseKeys(kind: LoaderKind, stage: number): readonly I18nKey[] {
  const stages = LOADER_PHRASE_KEYS[kind];
  return stages[Math.min(Math.max(stage, 0), stages.length - 1)] as readonly I18nKey[];
}

/** Every phrase key of a kind, in stage order — the set a loader may ever show. */
export function allLoaderPhraseKeys(kind: LoaderKind): readonly I18nKey[] {
  return LOADER_PHRASE_KEYS[kind].flat();
}
