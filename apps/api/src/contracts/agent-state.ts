import { z } from 'zod';
import { ReplyLanguageSchema } from './common.js';
import { GuardFindingSchema } from './guards.js';
import { LeadInputSchema, type LeadInput } from './lead.js';
import { QualificationOutcomeSchema } from './result.js';
import {
  CompanyProfileSchema,
  DraftReplySchema,
  MatchedCaseSchema,
  RequirementsSchema,
  ScoreLeadOutputSchema,
} from './tools.js';
import { ToolCallRecordSchema } from './trace.js';

export const GraphNodeSchema = z.enum([
  'research',
  'matching',
  'writer',
  'policy_guard',
  'finalize',
]);
export type GraphNode = z.infer<typeof GraphNodeSchema>;

/** One supervisor decision: the plan step, recorded for the trace. */
export const RouteStepSchema = z.object({
  step: z.number().int().nonnegative(),
  next: GraphNodeSchema,
  reason: z.string().max(300),
});
export type RouteStep = z.infer<typeof RouteStepSchema>;

/**
 * State shared by the nodes of the agent graph. Each agent fills its own fields; the
 * supervisor reads them to plan the next step. Mirrored by the LangGraph annotation in
 * agents/state.ts.
 */
export const AgentStateSchema = z.object({
  traceId: z.uuid(),
  lead: LeadInputSchema,

  // input guard
  inputVerdict: z.enum(['pass', 'review', 'reject']).nullable(),
  injectionDetected: z.boolean(),
  // research agent
  requirements: RequirementsSchema.nullable(),
  company: CompanyProfileSchema.nullable(),
  replyLanguage: ReplyLanguageSchema.nullable(),
  researchFailed: z.boolean(),
  // matching agent
  matchedCases: z.array(MatchedCaseSchema),
  scoring: ScoreLeadOutputSchema.nullable(),
  // writer agent + policy guard
  draft: DraftReplySchema.nullable(),
  writerFailed: z.boolean(),
  policyChecked: z.boolean(),
  /** Policy findings for the current draft only; replaced after every check. */
  draftFindings: z.array(GuardFindingSchema),
  rewrites: z.number().int().nonnegative(),

  // accumulated across the run
  findings: z.array(GuardFindingSchema),
  errors: z.array(z.string().max(1000)),
  toolCalls: z.array(ToolCallRecordSchema),
  routeLog: z.array(RouteStepSchema),
  promptVersions: z.record(z.string(), z.string()),
  retries: z.number().int().nonnegative(),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),

  // control flow and result
  steps: z.number().int().nonnegative(),
  /** Epoch ms after which the supervisor stops planning new steps (null = no budget). */
  deadline: z.number().int().nullable(),
  next: GraphNodeSchema.nullable(),
  outcome: QualificationOutcomeSchema.nullable(),
  leadId: z.uuid().nullable(),
});
export type AgentState = z.infer<typeof AgentStateSchema>;

export function createInitialState(
  traceId: string,
  lead: LeadInput,
  deadline: number | null = null,
): AgentState {
  return {
    traceId,
    lead,
    inputVerdict: null,
    injectionDetected: false,
    requirements: null,
    company: null,
    replyLanguage: null,
    researchFailed: false,
    matchedCases: [],
    scoring: null,
    draft: null,
    writerFailed: false,
    policyChecked: false,
    draftFindings: [],
    rewrites: 0,
    findings: [],
    errors: [],
    toolCalls: [],
    routeLog: [],
    promptVersions: {},
    retries: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    steps: 0,
    deadline,
    next: null,
    outcome: null,
    leadId: null,
  };
}
