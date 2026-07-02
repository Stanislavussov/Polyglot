import { and, count, desc, eq, gte, lt, ne, or } from "drizzle-orm";
import { getDb } from "../connection.js";
import { videoPhrases, videoProcesses, videoTranscriptCache } from "../schema.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CreateVideoProcessInput {
  userId: number;
  videoId: string;
  videoUrl: string;
  title?: string;
  durationSeconds?: number;
  language: string;
  transcriptType?: string;
}

export interface SaveVideoPhraseInput {
  phrase: string;
  nativeTranslation?: string;
  emoji?: string;
  phraseType?: string;
  level?: string;
  context?: string;
  timestampSeconds?: number;
  sortOrder: number;
}

/* ------------------------------------------------------------------ */
/*  Repository                                                         */
/* ------------------------------------------------------------------ */

export const videoVocabularyRepository = {
  /* ---- Processes ---- */

  async createProcess(input: CreateVideoProcessInput) {
    const db = getDb();
    const [row] = await db
      .insert(videoProcesses)
      .values({
        userId: input.userId,
        videoId: input.videoId,
        videoUrl: input.videoUrl,
        title: input.title,
        durationSeconds: input.durationSeconds,
        language: input.language,
        transcriptType: input.transcriptType,
        status: "pending",
      })
      .returning();
    return row;
  },

  async updateProcessStatus(
    processId: number,
    status: "pending" | "processing" | "completed" | "failed",
    errorMessage?: string,
  ) {
    const db = getDb();
    await db
      .update(videoProcesses)
      .set({ status, errorMessage: errorMessage ?? null, updatedAt: new Date() })
      .where(eq(videoProcesses.id, processId));
  },

  /** Mark processes stuck in pending/processing for longer than maxAgeMinutes as failed. */
  async expireStaleProcesses(maxAgeMinutes: number): Promise<number> {
    const db = getDb();
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000);
    const expired = await db
      .update(videoProcesses)
      .set({ status: "failed", errorMessage: "Processing timed out", updatedAt: new Date() })
      .where(
        and(
          or(eq(videoProcesses.status, "pending"), eq(videoProcesses.status, "processing")),
          lt(videoProcesses.updatedAt, cutoff),
        ),
      )
      .returning({ id: videoProcesses.id });
    return expired.length;
  },

  async findProcessById(processId: number) {
    const db = getDb();
    const [row] = await db.select().from(videoProcesses).where(eq(videoProcesses.id, processId)).limit(1);
    return row ?? null;
  },

  async findProcessByUserAndVideo(userId: number, videoId: string) {
    const db = getDb();
    const [row] = await db
      .select()
      .from(videoProcesses)
      .where(and(eq(videoProcesses.userId, userId), eq(videoProcesses.videoId, videoId)))
      .orderBy(desc(videoProcesses.createdAt))
      .limit(1);
    return row ?? null;
  },

  async findProcessesByUser(userId: number, page = 1, pageSize = 5, excludeFailed = false) {
    const db = getDb();
    const offset = (page - 1) * pageSize;
    const condition = excludeFailed
      ? and(eq(videoProcesses.userId, userId), ne(videoProcesses.status, "failed"))
      : eq(videoProcesses.userId, userId);
    const rows = await db
      .select()
      .from(videoProcesses)
      .where(condition)
      .orderBy(desc(videoProcesses.createdAt))
      .limit(pageSize)
      .offset(offset);
    return rows;
  },

  async countProcessesByUser(userId: number, excludeFailed = false) {
    const db = getDb();
    const condition = excludeFailed
      ? and(eq(videoProcesses.userId, userId), ne(videoProcesses.status, "failed"))
      : eq(videoProcesses.userId, userId);
    const [row] = await db.select({ count: count() }).from(videoProcesses).where(condition);
    return row?.count ?? 0;
  },

  /* ---- Monthly usage ---- */

  async getMonthlyUsageCount(userId: number, yearMonth: string): Promise<number> {
    const db = getDb();
    const startDate = new Date(`${yearMonth}-01T00:00:00Z`);
    const [year, month] = yearMonth.split("-").map(Number);
    const endDate = new Date(year, month, 1); // first day of next month

    const [row] = await db
      .select({ count: count() })
      .from(videoProcesses)
      .where(
        and(
          eq(videoProcesses.userId, userId),
          ne(videoProcesses.status, "failed"),
          gte(videoProcesses.createdAt, startDate),
          lt(videoProcesses.createdAt, endDate),
        ),
      );

    return row?.count ?? 0;
  },

  /* ---- Phrases ---- */

  async savePhrases(processId: number, phrases: SaveVideoPhraseInput[]) {
    if (phrases.length === 0) return;
    const db = getDb();
    await db.insert(videoPhrases).values(
      phrases.map((p) => ({
        videoProcessId: processId,
        phrase: p.phrase,
        nativeTranslation: p.nativeTranslation,
        emoji: p.emoji,
        phraseType: p.phraseType,
        level: p.level,
        context: p.context,
        timestampSeconds: p.timestampSeconds,
        sortOrder: p.sortOrder,
      })),
    );
  },

  async findPhrasesByProcess(processId: number, offset = 0, limit = 5) {
    const db = getDb();
    return db
      .select()
      .from(videoPhrases)
      .where(eq(videoPhrases.videoProcessId, processId))
      .orderBy(videoPhrases.sortOrder)
      .limit(limit)
      .offset(offset);
  },

  async countPhrasesByProcess(processId: number): Promise<number> {
    const db = getDb();
    const [row] = await db
      .select({ count: count() })
      .from(videoPhrases)
      .where(eq(videoPhrases.videoProcessId, processId));
    return row?.count ?? 0;
  },

  async findPhraseById(phraseId: number) {
    const db = getDb();
    const [row] = await db.select().from(videoPhrases).where(eq(videoPhrases.id, phraseId)).limit(1);
    return row ?? null;
  },

  async markPhraseSaved(phraseId: number, entryId: number) {
    const db = getDb();
    await db.update(videoPhrases).set({ savedEntryId: entryId }).where(eq(videoPhrases.id, phraseId));
  },

  /**
   * List every phrase this user has already had generated across their previous
   * videos in the given language. Used to avoid regenerating the same phrases on
   * subsequent videos. `excludeProcessId` omits the current process (its rows are
   * saved after extraction anyway, but this keeps the query intent explicit).
   */
  async findKnownPhrasesByUser(userId: number, language: string, excludeProcessId?: number): Promise<string[]> {
    const db = getDb();
    const conditions = [eq(videoProcesses.userId, userId), eq(videoProcesses.language, language)];
    if (excludeProcessId !== undefined) conditions.push(ne(videoPhrases.videoProcessId, excludeProcessId));
    const rows = await db
      .select({ phrase: videoPhrases.phrase })
      .from(videoPhrases)
      .innerJoin(videoProcesses, eq(videoPhrases.videoProcessId, videoProcesses.id))
      .where(and(...conditions));
    return rows.map((r) => r.phrase);
  },

  /* ---- Transcript cache ---- */

  async findCachedTranscript(videoId: string, language: string) {
    const db = getDb();
    const [row] = await db
      .select()
      .from(videoTranscriptCache)
      .where(and(eq(videoTranscriptCache.videoId, videoId), eq(videoTranscriptCache.language, language)))
      .limit(1);
    return row ?? null;
  },

  async cacheTranscript(videoId: string, language: string, transcript: string, transcriptType?: string) {
    const db = getDb();
    await db
      .insert(videoTranscriptCache)
      .values({ videoId, language, transcript, transcriptType })
      .onConflictDoNothing();
  },
};
