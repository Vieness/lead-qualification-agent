import type { Decision, GuardCode, GuardFinding, RunStatus } from '../contracts/index.js';

/** Findings that end the run without a reply. */
const REJECT_CODES: ReadonlySet<GuardCode> = new Set(['spam', 'invalid_input']);

/** Findings that forbid an automatic reply: a human reviews the lead first. */
export const REVIEW_CODES: ReadonlySet<GuardCode> = new Set([
  'prompt_injection',
  'approval_required',
  'price_promise',
  'deadline_promise',
  'discount_promise',
  'guarantee_promise',
  'internal_leak',
  'invalid_llm_output',
  'step_limit_reached',
  'time_budget_exceeded',
  'llm_unavailable',
  'inconsistent_outcome',
]);

export type Verdict = { decision: Decision; status: RunStatus };

export const STATUS_FOR: Record<Decision, RunStatus> = {
  reject: 'rejected',
  human_review: 'pending_approval',
  auto_reply: 'completed',
};

/**
 * The single place that turns guard findings into an outcome. Pure and deterministic: the LLM
 * can influence what is found, never what is decided.
 */
export function decide({
  findings,
  hasDraft,
}: {
  findings: GuardFinding[];
  hasDraft: boolean;
}): Verdict {
  const codes = new Set(findings.map((f) => f.code));
  const decision: Decision = [...codes].some((c) => REJECT_CODES.has(c))
    ? 'reject'
    : !hasDraft || [...codes].some((c) => REVIEW_CODES.has(c))
      ? 'human_review'
      : 'auto_reply';
  return { decision, status: STATUS_FOR[decision] };
}
