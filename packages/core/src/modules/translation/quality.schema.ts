import { z } from "zod";

export const qualityIssueSchema = z.object({
  fieldPath: z.string(),
  severity: z.enum(["blocking", "warning", "info"]),
  message: z.string(),
  repairInstruction: z.string().nullable(),
});

export const semanticJudgeSchema = z.object({
  issues: z.array(qualityIssueSchema),
  summary: z.string().nullable(),
});

export type SemanticJudgeResult = z.infer<typeof semanticJudgeSchema>;
