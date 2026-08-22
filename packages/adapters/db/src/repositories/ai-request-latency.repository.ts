import { desc, gte, sql } from "drizzle-orm";
import { getDb } from "../connection.js";
import { aiRequestLatencies } from "../schema.js";

export type AIRequestKind = "object" | "text" | "chat" | "speech";

export interface RecordAIRequestLatencyInput {
  modelId: string;
  requestKind: AIRequestKind;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  success: boolean;
  userId?: number;
  error?: string;
}

export interface AIRequestLatencySummary {
  modelId: string;
  requestCount: number;
  averageDurationMs: number;
  maxDurationMs: number;
  successRate: number;
  averageInputTokens: number;
  averageOutputTokens: number;
}

export const aiRequestLatencyRepository = {
  async record(input: RecordAIRequestLatencyInput): Promise<void> {
    const db = getDb();
    await db.insert(aiRequestLatencies).values({
      modelId: input.modelId,
      requestKind: input.requestKind,
      durationMs: input.durationMs,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costUsd: input.costUsd,
      success: input.success,
      userId: input.userId,
      error: input.error,
    });
  },

  async getModelLatencySummary(days = 7, limit = 12): Promise<AIRequestLatencySummary[]> {
    const db = getDb();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        modelId: aiRequestLatencies.modelId,
        requestCount: sql<number>`count(*)::int`,
        averageDurationMs: sql<number>`round(avg(${aiRequestLatencies.durationMs}))::int`,
        maxDurationMs: sql<number>`max(${aiRequestLatencies.durationMs})::int`,
        successRate: sql<number>`coalesce(avg(case when ${aiRequestLatencies.success} then 1.0 else 0.0 end), 0)`,
        averageInputTokens: sql<number>`round(avg(${aiRequestLatencies.inputTokens}))::int`,
        averageOutputTokens: sql<number>`round(avg(${aiRequestLatencies.outputTokens}))::int`,
      })
      .from(aiRequestLatencies)
      .where(gte(aiRequestLatencies.createdAt, since))
      .groupBy(aiRequestLatencies.modelId)
      .orderBy(desc(sql`count(*)`))
      .limit(limit);

    return rows.map((row) => ({
      modelId: row.modelId,
      requestCount: row.requestCount,
      averageDurationMs: row.averageDurationMs,
      maxDurationMs: row.maxDurationMs,
      successRate: Number(row.successRate),
      averageInputTokens: row.averageInputTokens,
      averageOutputTokens: row.averageOutputTokens,
    }));
  },
};
