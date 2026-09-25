import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import { releaseAnnouncementJobs } from "../schema.js";

/** One note as approved in the panel: the id dedups per reader, the texts are what is sent. */
export interface ReleaseAnnouncementJobNote {
  id: string;
  texts: Record<string, string>;
}

export interface ReleaseAnnouncementJob {
  id: number;
  notes: ReleaseAnnouncementJobNote[];
  audienceGroups: string[];
  status: "pending" | "sending" | "sent" | "failed";
  result: Record<string, string | number> | null;
  createdBy: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface EnqueueReleaseAnnouncementInput {
  notes: ReleaseAnnouncementJobNote[];
  audienceGroups: string[];
  createdBy: string | null;
}

export const releaseAnnouncementJobRepository = {
  async enqueue(input: EnqueueReleaseAnnouncementInput): Promise<ReleaseAnnouncementJob> {
    const db = getDb();
    const [row] = await db
      .insert(releaseAnnouncementJobs)
      .values({
        notes: input.notes,
        audienceGroups: input.audienceGroups,
        createdBy: input.createdBy,
      })
      .returning();
    if (!row) throw new Error("Failed to enqueue release announcement");
    return row as ReleaseAnnouncementJob;
  },

  /**
   * Take the oldest pending job, marking it `sending` in the same statement.
   * `for update skip locked` is what makes a second worker — or the same worker
   * whose previous tick is still running — pick up a different row rather than
   * send the same announcement twice.
   */
  async claimNext(): Promise<ReleaseAnnouncementJob | null> {
    const db = getDb();
    const [row] = await db
      .update(releaseAnnouncementJobs)
      .set({ status: "sending", startedAt: new Date() })
      .where(
        eq(
          releaseAnnouncementJobs.id,
          sql`(select id from ${releaseAnnouncementJobs} where status = 'pending' order by id limit 1 for update skip locked)`,
        ),
      )
      .returning();
    return (row as ReleaseAnnouncementJob | undefined) ?? null;
  },

  async finish(id: number, status: "sent" | "failed", result: Record<string, string | number>): Promise<void> {
    const db = getDb();
    await db
      .update(releaseAnnouncementJobs)
      .set({ status, result, finishedAt: new Date() })
      .where(eq(releaseAnnouncementJobs.id, id));
  },

  /** Recent runs, newest first — the panel's record of what was told to whom and when. */
  async list(limit = 20): Promise<ReleaseAnnouncementJob[]> {
    const db = getDb();
    const rows = await db.select().from(releaseAnnouncementJobs).orderBy(desc(releaseAnnouncementJobs.id)).limit(limit);
    return rows as ReleaseAnnouncementJob[];
  },
};
