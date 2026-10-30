import {
  PROJECT_TYPE_LABELS,
  type GuardFinding,
  type QualificationOutcome,
} from '../contracts/index.js';
import { decide, enforceOutcome } from '../guards/index.js';
import { logEvent } from '../observability/index.js';
import { budgetToUsd, formatUsd } from '../tools/index.js';
import type { GraphState, GraphUpdate } from './state.js';

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** One-line, deterministic summary for the sales team (no LLM: it must match the data). */
export function summarize(outcome: Omit<QualificationOutcome, 'summary'>): string {
  const { decision, tier, score, requirements, matchedCases, guardrails } = outcome;
  if (decision === 'reject') {
    const reason = guardrails.findings.find((f) => f.code === 'spam' || f.code === 'invalid_input');
    return `Rejected: ${reason?.message ?? 'input rejected'}`.slice(0, 1000);
  }

  const parts: string[] = [];
  if (requirements) {
    parts.push(PROJECT_TYPE_LABELS[requirements.projectType].en);
    const usd = budgetToUsd(requirements.budget);
    parts.push(usd === null ? 'budget not stated' : `budget ≈ ${formatUsd(usd)}`);
  }
  parts.push(`${matchedCases.length} similar case${matchedCases.length === 1 ? '' : 's'}`);

  const reviewCodes = [
    ...new Set(guardrails.findings.filter((f) => f.severity !== 'info').map((f) => f.code)),
  ];
  const ending =
    decision === 'auto_reply'
      ? 'Auto-reply drafted.'
      : `Needs human review: ${reviewCodes.join(', ') || 'no draft'}.`;

  const cap = outcome.tierCap ? `, capped: ${outcome.tierCap.reasons.join('; ')}` : '';
  const head = requirements ? `${capitalize(tier)} lead (${score}/100${cap})` : 'Lead not analysed';
  return `${head}: ${parts.join(', ')}. ${ending}`.slice(0, 1000);
}

/** Turns the final state into the outcome: decide → assemble → output guard. */
export function buildOutcome(state: GraphState): QualificationOutcome {
  const findings: GuardFinding[] = [...state.findings, ...state.draftFindings];
  const verdict = decide({ findings, hasDraft: state.draft !== null });
  const rejected = verdict.decision === 'reject';

  const outcome: Omit<QualificationOutcome, 'summary'> = {
    traceId: state.traceId,
    status: verdict.status,
    decision: verdict.decision,
    score: rejected ? 0 : (state.scoring?.score ?? 0),
    tier: rejected ? 'spam' : (state.scoring?.tier ?? 'cold'),
    requirements: state.requirements,
    company: state.company,
    matchedCases: state.matchedCases,
    scoreBreakdown: rejected ? [] : (state.scoring?.breakdown ?? []),
    tierCap: rejected ? null : (state.scoring?.tierCap ?? null),
    draftReply: rejected ? null : state.draft,
    guardrails: { injectionDetected: state.injectionDetected, findings, retries: state.retries },
    promptVersions: state.promptVersions,
  };
  return enforceOutcome({ ...outcome, summary: summarize(outcome) });
}

export function finalizeNode(state: GraphState): GraphUpdate {
  const outcome = buildOutcome(state);
  for (const f of outcome.guardrails.findings) {
    logEvent(
      'guard.finding',
      { guard: f.guard, code: f.code, severity: f.severity },
      f.severity === 'critical' ? 'warn' : 'info',
    );
  }
  return { outcome };
}
