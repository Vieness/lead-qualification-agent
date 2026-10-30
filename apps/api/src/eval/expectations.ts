import { z } from 'zod';
import {
  DecisionSchema,
  GuardCodeSchema,
  ReplyLanguageSchema,
  RunStatusSchema,
  ScoreRuleSchema,
  TierSchema,
} from '../contracts/index.js';

const RangeSchema = z
  .strictObject({ min: z.number().optional(), max: z.number().optional() })
  .refine((r) => r.min === undefined || r.max === undefined || r.min <= r.max, 'min exceeds max');

/**
 * Business truth for one sample in data/expected. Only decision and status are required; the
 * rest is checked when present. Tier and score are ranges so the same file is fair to the
 * demo mock and to a real model.
 */
export const ExpectationSchema = z.strictObject({
  description: z.string().optional(),
  decision: DecisionSchema,
  status: RunStatusSchema,
  tier: z.array(TierSchema).min(1).optional(),
  score: RangeSchema.optional(),
  scoreRules: z.partialRecord(ScoreRuleSchema, RangeSchema).optional(),
  findingsInclude: z.array(GuardCodeSchema).optional(),
  findingsExclude: z.array(GuardCodeSchema).optional(),
  injectionDetected: z.boolean().optional(),
  injectionSource: z.enum(['message', 'enrichment']).optional(),
  replyLanguage: ReplyLanguageSchema.nullable().optional(),
  minMatchedCases: z.number().int().nonnegative().optional(),
  maxLlmCalls: z.number().int().nonnegative().optional(),
});
export type Expectation = z.infer<typeof ExpectationSchema>;
