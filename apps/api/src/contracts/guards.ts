import { z } from 'zod';

export const GuardSchema = z.enum(['input', 'policy', 'output']);
export type Guard = z.infer<typeof GuardSchema>;

export const GuardCodeSchema = z.enum([
  // input guard
  'invalid_input',
  'prompt_injection',
  'spam',
  'pii_detected',
  // policy guard
  'price_promise',
  'deadline_promise',
  'discount_promise',
  'guarantee_promise',
  'internal_leak',
  'approval_required',
  'unsupported_language',
  // output guard / orchestration
  'invalid_llm_output',
  'step_limit_reached',
  'time_budget_exceeded',
  'llm_unavailable',
  'inconsistent_outcome',
]);
export type GuardCode = z.infer<typeof GuardCodeSchema>;

export const SeveritySchema = z.enum(['info', 'warning', 'critical']);
export type Severity = z.infer<typeof SeveritySchema>;

export const GuardFindingSchema = z.object({
  guard: GuardSchema,
  code: GuardCodeSchema,
  severity: SeveritySchema,
  message: z.string().min(1).max(500),
});
export type GuardFinding = z.infer<typeof GuardFindingSchema>;
