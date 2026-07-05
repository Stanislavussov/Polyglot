import type { SQL } from "drizzle-orm";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import { escapeLikePattern } from "../like-escape.js";
import type { IssueStatus, IssueType, ReportedIssue } from "../schema.js";
import { reportedIssues, users } from "../schema.js";

export interface ReportedIssueListFilters {
  page: number;
  limit: number;
  status?: IssueStatus;
  search?: string;
}

export interface ReportedIssueListItem {
  id: number;
  userId: number;
  type: IssueType;
  description: string;
  status: IssueStatus;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: number;
    telegramId: number;
    username: string | null;
  };
}

export interface ReportedIssueListResult {
  issues: ReportedIssueListItem[];
  total: number;
  page: number;
  limit: number;
}

function buildListWhere(filters: ReportedIssueListFilters): SQL | undefined {
  const conditions: SQL[] = [];

  if (filters.status) {
    conditions.push(eq(reportedIssues.status, filters.status));
  }

  const search = filters.search?.trim();
  if (search) {
    const pattern = `%${escapeLikePattern(search)}%`;
    const searchCondition = or(
      ilike(reportedIssues.description, pattern),
      ilike(users.username, pattern),
      sql`${users.telegramId}::text ilike ${pattern}`,
    );

    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

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

  async list(filters: ReportedIssueListFilters): Promise<ReportedIssueListResult> {
    const db = getDb();
    const offset = (filters.page - 1) * filters.limit;
    const where = buildListWhere(filters);

    const query = db
      .select({
        id: reportedIssues.id,
        userId: reportedIssues.userId,
        type: reportedIssues.type,
        description: reportedIssues.description,
        status: reportedIssues.status,
        createdAt: reportedIssues.createdAt,
        updatedAt: reportedIssues.updatedAt,
        user: {
          id: users.id,
          telegramId: users.telegramId,
          username: users.username,
        },
      })
      .from(reportedIssues)
      .innerJoin(users, eq(reportedIssues.userId, users.id))
      .$dynamic()
      .orderBy(desc(reportedIssues.createdAt))
      .limit(filters.limit)
      .offset(offset);

    const countQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(reportedIssues)
      .innerJoin(users, eq(reportedIssues.userId, users.id))
      .$dynamic();

    const [issues, countRows] = await Promise.all([
      where ? query.where(where) : query,
      where ? countQuery.where(where) : countQuery,
    ]);

    return {
      issues,
      total: countRows[0]?.count ?? 0,
      page: filters.page,
      limit: filters.limit,
    };
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
