import type {
  ArticleProcessStatus,
  ArticleVocabularyRepository,
  CreateArticleProcessInput,
  SaveArticlePhraseInput,
} from "@polyglot/core";
import { and, count, desc, eq, lt, ne, or } from "drizzle-orm";
import { getDb } from "../connection.js";
import { articlePhrases, articleProcesses } from "../schema.js";

function ownedBy(userId: number, excludeFailed: boolean) {
  return excludeFailed
    ? and(eq(articleProcesses.userId, userId), ne(articleProcesses.status, "failed"))
    : eq(articleProcesses.userId, userId);
}

export const articleVocabularyRepository: ArticleVocabularyRepository = {
  async createProcess(input: CreateArticleProcessInput) {
    const [row] = await getDb()
      .insert(articleProcesses)
      .values({ ...input, status: "pending" })
      .returning();
    if (!row) throw new Error("article_processes insert returned no row");
    return row;
  },

  async updateProcessStatus(processId: number, status: ArticleProcessStatus, errorMessage?: string) {
    await getDb()
      .update(articleProcesses)
      .set({ status, errorMessage: errorMessage ?? null, updatedAt: new Date() })
      .where(eq(articleProcesses.id, processId));
  },

  async updateProcessLanguage(processId: number, language: string) {
    await getDb()
      .update(articleProcesses)
      .set({ language, updatedAt: new Date() })
      .where(eq(articleProcesses.id, processId));
  },

  async expireStaleProcesses(maxAgeMinutes: number) {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000);
    const expired = await getDb()
      .update(articleProcesses)
      .set({ status: "failed", errorMessage: "Processing timed out", updatedAt: new Date() })
      .where(
        and(
          or(eq(articleProcesses.status, "pending"), eq(articleProcesses.status, "processing")),
          lt(articleProcesses.updatedAt, cutoff),
        ),
      )
      .returning({ id: articleProcesses.id });
    return expired.length;
  },

  async findProcessById(processId: number) {
    const [row] = await getDb().select().from(articleProcesses).where(eq(articleProcesses.id, processId)).limit(1);
    return row ?? null;
  },

  async findProcessByUserAndUrl(userId: number, url: string) {
    const [row] = await getDb()
      .select()
      .from(articleProcesses)
      .where(and(eq(articleProcesses.userId, userId), eq(articleProcesses.url, url)))
      .orderBy(desc(articleProcesses.createdAt))
      .limit(1);
    return row ?? null;
  },

  async findProcessesByUser(userId: number, page: number, pageSize: number, excludeFailed: boolean) {
    return getDb()
      .select()
      .from(articleProcesses)
      .where(ownedBy(userId, excludeFailed))
      .orderBy(desc(articleProcesses.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
  },

  async countProcessesByUser(userId: number, excludeFailed: boolean) {
    const [row] = await getDb().select({ count: count() }).from(articleProcesses).where(ownedBy(userId, excludeFailed));
    return row?.count ?? 0;
  },

  async savePhrases(processId: number, phrases: SaveArticlePhraseInput[]) {
    if (phrases.length === 0) return;
    await getDb()
      .insert(articlePhrases)
      .values(phrases.map((p) => ({ ...p, articleProcessId: processId })));
  },

  async findPhrasesByProcess(processId: number, offset: number, limit: number) {
    return getDb()
      .select()
      .from(articlePhrases)
      .where(eq(articlePhrases.articleProcessId, processId))
      .orderBy(articlePhrases.sortOrder)
      .limit(limit)
      .offset(offset);
  },

  async countPhrasesByProcess(processId: number) {
    const [row] = await getDb()
      .select({ count: count() })
      .from(articlePhrases)
      .where(eq(articlePhrases.articleProcessId, processId));
    return row?.count ?? 0;
  },

  async findPhraseById(phraseId: number) {
    const [row] = await getDb().select().from(articlePhrases).where(eq(articlePhrases.id, phraseId)).limit(1);
    return row ?? null;
  },

  async markPhraseSaved(phraseId: number, entryId: number) {
    await getDb().update(articlePhrases).set({ savedEntryId: entryId }).where(eq(articlePhrases.id, phraseId));
  },

  async findKnownPhrasesByUser(userId: number, language: string, excludeProcessId: number) {
    const rows = await getDb()
      .select({ phrase: articlePhrases.phrase })
      .from(articlePhrases)
      .innerJoin(articleProcesses, eq(articlePhrases.articleProcessId, articleProcesses.id))
      .where(
        and(
          eq(articleProcesses.userId, userId),
          eq(articleProcesses.language, language),
          ne(articlePhrases.articleProcessId, excludeProcessId),
        ),
      );
    return rows.map((r) => r.phrase);
  },
};
