import { desc, eq } from "drizzle-orm";
import { getDb } from "../connection.js";
import type { IssueStatus, IssueType, ReportedIssue } from "../schema.js";
import { reportedIssues } from "../schema.js";

export const reportedIssueRepository = {
  async create(userId: number, type: IssueType, description: string): Promise<ReportedIssue> {
    const db = getDb();
    const rows = await db.insert(reportedIssues).values({ userId, type, description }).returning();
    return rows[0]!;
  },

  async findByUser(userId: number): Promise<ReportedIssue[]> {
    const db = getDb();
    return db
      .select()
      .from(reportedIssues)
      .where(eq(reportedIssues.userId, userId))
      .orderBy(desc(reportedIssues.createdAt));
  },

  async findByStatus(status: IssueStatus): Promise<ReportedIssue[]> {
    const db = getDb();
    return db
      .select()
      .from(reportedIssues)
      .where(eq(reportedIssues.status, status))
      .orderBy(desc(reportedIssues.createdAt));
  },

  async updateStatus(issueId: number, status: IssueStatus): Promise<ReportedIssue | null> {
    const db = getDb();
    const rows = await db
      .update(reportedIssues)
      .set({ status, updatedAt: new Date() })
      .where(eq(reportedIssues.id, issueId))
      .returning();
    return rows[0] ?? null;
  },
};
