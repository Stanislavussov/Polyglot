/**
 * Port for word packs (Task 87) — curated words a lapsed learner is won back with.
 */
import type { LocalizedPackWord } from "../modules/word-packs/types.js";

export interface WordPack {
  id: number;
  slug: string;
  emoji: string;
  title: string;
  /** Interface-language code → title; partial, missing codes fall back to `title`. */
  titleI18n: Record<string, string>;
  isActive: boolean;
  sourceDictionaryId: number | null;
  createdByUserId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One servable word, with the pack it belongs to. */
export interface ActiveWordPackItem {
  itemId: number;
  packId: number;
  packEmoji: string;
  packTitle: string;
  packTitleI18n: Record<string, string>;
  sourceLang: string;
  sourceHeadword: string;
  level: string;
  emoji: string | null;
  /** Language code → the word in that language. */
  headwords: Record<string, string>;
}

export interface PublishWordPackInput {
  dictionaryId: number;
  createdByUserId: number;
  title: string;
  emoji: string;
}

export interface WordPackRepository {
  /** The pack a dictionary was published as, created on first publish and retitled on the next. */
  publishFromDictionary(input: PublishWordPackInput): Promise<WordPack>;
  /** Adds new words and refreshes known ones; an item switched off by hand stays off. */
  upsertItems(packId: number, items: LocalizedPackWord[]): Promise<void>;
  countActiveItems(packId: number): Promise<number>;
  /** Every active word of every active pack. */
  findActiveItems(): Promise<ActiveWordPackItem[]>;
}
