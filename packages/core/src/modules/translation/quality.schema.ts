import { z } from "zod";

export const qualityIssueSchema = z.object({
  fieldPath: z.string(),
  // "advisory" is a non-blocking severity for self-documenting, low-confidence
  // deterministic rules (see collectQualityIssues): it does not force
  // needs_review, does not trigger repair, and — unlike a blocking issue — does
  // not suppress the high-risk semantic judge.
  severity: z.enum(["blocking", "warning", "advisory", "info"]),
  message: z.string(),
  repairInstruction: z.string().nullable(),
});

export const semanticJudgeSchema = z.object({
  issues: z.array(qualityIssueSchema),
  summary: z.string().nullable(),
});

export type SemanticJudgeResult = z.infer<typeof semanticJudgeSchema>;
