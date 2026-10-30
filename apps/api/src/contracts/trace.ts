import { z } from 'zod';
import { AgentNameSchema } from './common.js';
import { ToolNameSchema } from './tools.js';

/** One tool invocation, stored in `tool_calls` and returned by GET /runs/:id/trace. */
export const ToolCallRecordSchema = z
  .object({
    traceId: z.uuid(),
    step: z.number().int().nonnegative(),
    agent: AgentNameSchema,
    tool: ToolNameSchema,
    /** Arguments after PII masking. */
    args: z.unknown(),
    result: z.unknown().nullable(),
    error: z.string().max(2000).nullable(),
    latencyMs: z.number().nonnegative(),
    startedAt: z.iso.datetime(),
  })
  .refine((r) => r.result === null || r.error === null, 'A call has either a result or an error');
export type ToolCallRecord = z.infer<typeof ToolCallRecordSchema>;

export const LlmCallEventSchema = z.object({
  type: z.literal('llm_call'),
  at: z.iso.datetime(),
  purpose: z.string(),
  model: z.string().nullable(),
  latencyMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  stopReason: z.string().nullable(),
  error: z.string().max(2000).nullable(),
});

export const LlmRetryEventSchema = z.object({
  type: z.literal('llm_retry'),
  at: z.iso.datetime(),
  purpose: z.string(),
  attempt: z.number().int().positive(),
  delayMs: z.number().nonnegative(),
  errorKind: z.string(),
});

/** LLM activity inside a run, stored with the run and returned by the trace endpoint. */
export const TraceEventSchema = z.discriminatedUnion('type', [
  LlmCallEventSchema,
  LlmRetryEventSchema,
]);
export type TraceEvent = z.infer<typeof TraceEventSchema>;
