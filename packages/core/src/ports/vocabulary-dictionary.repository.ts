export interface VocabularyDictionary {
  id: number;
  userId: number;
  name: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface VocabularyDictionaryWithCount extends VocabularyDictionary {
  entryCount: number;
}

export interface VocabularyDictionaryRepository {
  normalizeName(name: string): string;
  getOrCreateDefault(userId: number): Promise<VocabularyDictionary>;
  listByUser(userId: number): Promise<VocabularyDictionaryWithCount[]>;
  findOwnedById(userId: number, dictionaryId: number): Promise<VocabularyDictionary | null>;
  create(userId: number, name: string): Promise<VocabularyDictionary>;
  rename(userId: number, dictionaryId: number, name: string): Promise<VocabularyDictionary | null>;
  delete(userId: number, dictionaryId: number): Promise<boolean>;
  addEntry(dictionaryId: number, entryId: number): Promise<void>;
  addEntryToDefault(userId: number, entryId: number): Promise<VocabularyDictionary>;
  entryBelongsToDictionary(entryId: number, dictionaryId: number): Promise<boolean>;
  entryBelongsToDefault(userId: number, entryId: number): Promise<boolean>;
  removeEntry(dictionaryId: number, entryId: number): Promise<number>;
  moveEntry(userId: number, fromDictionaryId: number, toDictionaryId: number, entryId: number): Promise<boolean>;
  listEntryDictionaries(userId: number, entryId: number): Promise<VocabularyDictionary[]>;
  listOtherDictionaries(userId: number, entryId: number): Promise<VocabularyDictionaryWithCount[]>;
  hasNonDefaultDictionary(userId: number): Promise<boolean>;
}
