import {
  ScoreLeadInputSchema,
  ScoreLeadOutputSchema,
  type ScoreBreakdownItem,
  type ScoreLeadInput,
  type ScoreLeadOutput,
  type TierCap,
  type Tier,
} from '../contracts/index.js';
import { budgetToUsd, formatUsd, pluralWeeks } from './currency.js';
import {
  BUDGET_BANDS,
  COMPANY_SIZE_POINTS,
  COMPLETENESS_PENALTY,
  CORE_SERVICES,
  MAX_CASE_POINTS,
  MIN_VIABLE_BUDGET_USD,
  MIN_VIABLE_WEEKS,
  NO_SERVICES_POINTS,
  POINTS_PER_MATCHED_CASE,
  RULE_MAX,
  SERVICE_SHARE_POINTS,
  TIER_THRESHOLDS,
  TIMELINE_BANDS,
  UNKNOWN_BUDGET_POINTS,
  UNKNOWN_TIMELINE_POINTS,
  UNVERIFIED_COMPANY_POINTS,
} from './scoring-rules.js';
import { defineTool } from './types.js';

/** Bands are ordered top-down and end with a catch-all entry, so a match always exists. */
function pick<T>(items: ReadonlyArray<T>, matches: (item: T) => boolean): T {
  const found = items.find(matches);
  if (found === undefined) throw new Error('Scoring bands must end with a catch-all entry');
  return found;
}

function budgetFit({ requirements }: ScoreLeadInput): ScoreBreakdownItem {
  const max = RULE_MAX.budget_fit;
  const amount = budgetToUsd(requirements.budget);
  if (amount === null) {
    return { rule: 'budget_fit', points: UNKNOWN_BUDGET_POINTS, max, reason: 'Budget not stated' };
  }
  const band = pick(BUDGET_BANDS, (b) => amount >= b.min);
  return {
    rule: 'budget_fit',
    points: band.points,
    max,
    reason: `${formatUsd(amount)} — ${band.label}`,
  };
}

function serviceFit({ requirements, matchedCasesCount }: ScoreLeadInput): ScoreBreakdownItem {
  const max = RULE_MAX.service_fit;
  const { services } = requirements;
  if (services.length === 0) {
    return { rule: 'service_fit', points: NO_SERVICES_POINTS, max, reason: 'Services unclear' };
  }
  const core = services.filter((s) => CORE_SERVICES.has(s)).length;
  const sharePoints = Math.round((SERVICE_SHARE_POINTS * core) / services.length);
  const casePoints = Math.min(MAX_CASE_POINTS, matchedCasesCount * POINTS_PER_MATCHED_CASE);
  return {
    rule: 'service_fit',
    points: sharePoints + casePoints,
    max,
    reason: `${core}/${services.length} requested services are core; ${matchedCasesCount} similar case(s)`,
  };
}

function completeness({ requirements }: ScoreLeadInput): ScoreBreakdownItem {
  const max = RULE_MAX.completeness;
  const missing = requirements.missingInfo.filter((m) => m !== 'company');
  return {
    rule: 'completeness',
    points: Math.max(0, max - COMPLETENESS_PENALTY * missing.length),
    max,
    reason: missing.length ? `Missing: ${missing.join(', ')}` : 'Budget, timeline and scope given',
  };
}

function timelineRealism({ requirements }: ScoreLeadInput): ScoreBreakdownItem {
  const max = RULE_MAX.timeline_realism;
  const weeks = requirements.timeline?.weeks ?? null;
  if (weeks === null) {
    return {
      rule: 'timeline_realism',
      points: UNKNOWN_TIMELINE_POINTS,
      max,
      reason: 'Timeline not stated',
    };
  }
  const band = pick(TIMELINE_BANDS, (b) => weeks >= b.minWeeks);
  return {
    rule: 'timeline_realism',
    points: band.points,
    max,
    reason: `${pluralWeeks(weeks)} — ${band.label}`,
  };
}

function companySignal({ company }: ScoreLeadInput): ScoreBreakdownItem {
  const max = RULE_MAX.company_signal;
  if (company.found && company.size) {
    return {
      rule: 'company_signal',
      points: COMPANY_SIZE_POINTS[company.size],
      max,
      reason: `Verified company, ${company.size} employees`,
    };
  }
  if (company.domain) {
    return {
      rule: 'company_signal',
      points: UNVERIFIED_COMPANY_POINTS,
      max,
      reason: 'Corporate domain, company not verified',
    };
  }
  return { rule: 'company_signal', points: 0, max, reason: 'No company or corporate email' };
}

export function tierFor(score: number): Exclude<Tier, 'spam'> {
  return pick(TIER_THRESHOLDS, (t) => score >= t.min).tier;
}

/** Deal-breakers that cap the tier at cold; unknown budget or timeline is not one. */
export function viabilityCap({ requirements }: ScoreLeadInput): TierCap | null {
  const reasons: string[] = [];
  const budget = budgetToUsd(requirements.budget);
  if (budget !== null && budget < MIN_VIABLE_BUDGET_USD) {
    reasons.push(
      `budget ${formatUsd(budget)} is below the ${formatUsd(MIN_VIABLE_BUDGET_USD)} minimum`,
    );
  }
  const weeks = requirements.timeline?.weeks ?? null;
  if (weeks !== null && weeks < MIN_VIABLE_WEEKS) {
    reasons.push(`a timeline of ${pluralWeeks(weeks)} is not realistic`);
  }
  return reasons.length > 0 ? { tier: 'cold', reasons } : null;
}

/** Deterministic, explainable lead score: the LLM never decides points or tiers. */
export function scoreLead(input: ScoreLeadInput): ScoreLeadOutput {
  const breakdown = [budgetFit, serviceFit, completeness, timelineRealism, companySignal].map(
    (rule) => rule(input),
  );
  const score = breakdown.reduce((sum, item) => sum + item.points, 0);
  const tierCap = viabilityCap(input);
  return { score, tier: tierCap ? tierCap.tier : tierFor(score), breakdown, tierCap };
}

export const scoreLeadTool = defineTool({
  name: 'score_lead',
  description:
    'Scores the lead from 0 to 100 with fixed business rules (budget, services, completeness, timeline, company) and returns the tier and a per-rule breakdown.',
  input: ScoreLeadInputSchema,
  output: ScoreLeadOutputSchema,
  execute: async (input) => ({ data: scoreLead(input) }),
});
