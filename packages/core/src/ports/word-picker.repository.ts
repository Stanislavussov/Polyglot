/**
 * Port interfaces for the word picker — curated angles and the sets they produce.
 */

export interface WordPickerPreset {
  id: number;
  slug: string;
  emoji: string;
  title: string;
  /** Interface-language code → title; partial, missing codes fall back to `title`. */
  titleI18n: Record<string, string>;
  prompt: string;
  /** Learning languages this angle is offered for; empty means every language. */
  learningLangs: string[];
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WordPickerRun {
  id: number;
  userId: number;
  presetId: number | null;
  presetTitle: string;
  presetEmoji: string;
  langCode: string;
  nativeLang: string;
  createdAt: Date;
}

export interface WordPickerItem {
  id: number;
  runId: number;
  word: string;
  nativeTranslation: string;
  emoji: string | null;
  itemType: string | null;
  level: string | null;
  exampleTarget: string | null;
  exampleNative: string | null;
  note: string | null;
  sortOrder: number;
  savedEntryId: number | null;
  createdAt: Date;
}

export interface CreateWordPickerRunInput {
  userId: number;
  presetId: number;
  presetTitle: string;
  presetEmoji: string;
  langCode: string;
  nativeLang: string;
}

export interface WordPickerItemInput {
  word: string;
  nativeTranslation: string;
  emoji: string | null;
  itemType: string | null;
  level: string | null;
  exampleTarget: string | null;
  exampleNative: string | null;
  note: string | null;
}

export interface WordPickerPresetRepository {
  findById(id: number): Promise<WordPickerPreset | null>;
  /** Active presets offered for any of `langCodes` — those scoped to one plus the unscoped ones. */
  findActiveForLangs(langCodes: string[]): Promise<WordPickerPreset[]>;
}

export interface WordPickerRunRepository {
  createRun(input: CreateWordPickerRunInput): Promise<WordPickerRun>;
  saveItems(runId: number, items: WordPickerItemInput[]): Promise<WordPickerItem[]>;
  findRunById(runId: number): Promise<WordPickerRun | null>;
  findItemsByRun(runId: number): Promise<WordPickerItem[]>;
  findItemById(itemId: number): Promise<WordPickerItem | null>;
  findUnsavedItemsByRun(runId: number): Promise<WordPickerItem[]>;
  markItemSaved(itemId: number, entryId: number): Promise<void>;
  /** Every word already shown to this user for this angle and language. */
  findWordsShownTo(userId: number, presetId: number, langCode: string, limit?: number): Promise<string[]>;
}
