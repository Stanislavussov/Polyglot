/**
 * Port interface for the Reported Issue Repository.
 *
 * The bot only ever creates a report (the /report-issue conversation); the
 * list/status-update surface used by the admin panel stays adapter-only.
 */

export type IssueType = "bug" | "suggestion" | "other";

export interface ReportedIssue {
  id: number;
  userId: number;
  type: IssueType;
  description: string;
  status: "open" | "in_progress" | "resolved" | "rejected";
  createdAt: Date;
  updatedAt: Date;
}

export interface ReportedIssueRepository {
  create(userId: number, type: IssueType, description: string): Promise<ReportedIssue>;
}
