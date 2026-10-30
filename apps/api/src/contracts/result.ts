import { z } from 'zod';
import { DecisionSchema, RunStatusSchema, TierSchema } from './common.js';
import { GuardFindingSchema } from './guards.js';
import {
  CompanyProfileSchema,
  DraftReplySchema,
  MatchedCaseSchema,
  RequirementsSchema,
  ScoreBreakdownItemSchema,
  TierCapSchema,
} from './tools.js';

export const GuardrailsReportSchema = z.object({
  injectionDetected: z.boolean(),
  findings: z.array(GuardFindingSchema),
  retries: z.number().int().nonnegative(),
});
export type GuardrailsReport = z.infer<typeof GuardrailsReportSchema>;

/**
 * What the agent produced for one lead, before it is persisted. Research fields are nullable
 * because a rejected lead (spam, injection-only, invalid) stops before they are filled.
 */
export const QualificationOutcomeSchema = z.object({
  traceId: z.uuid(),
  status: RunStatusSchema,
  decision: DecisionSchema,
  score: z.number().int().min(0).max(100),
  tier: TierSchema,
  requirements: RequirementsSchema.nullable(),
  company: CompanyProfileSchema.nullable(),
  matchedCases: z.array(MatchedCaseSchema),
  scoreBreakdown: z.array(ScoreBreakdownItemSchema),
  tierCap: TierCapSchema.nullable(),
  draftReply: DraftReplySchema.nullable(),
  guardrails: GuardrailsReportSchema,
  /** Prompt id → version used in this run, e.g. { "writer": "1.2.0" }. */
  promptVersions: z.record(z.string(), z.string()),
  summary: z.string().min(1).max(1000),
});
export type QualificationOutcome = z.infer<typeof QualificationOutcomeSchema>;

/** Response body of POST /leads and GET /leads/:id. */
export const QualificationResultSchema = QualificationOutcomeSchema.extend({
  leadId: z.uuid(),
});
export type QualificationResult = z.infer<typeof QualificationResultSchema>;
