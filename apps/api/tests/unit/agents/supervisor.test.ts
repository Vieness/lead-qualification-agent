import { describe, expect, it } from 'vitest';
import { nextStep, summarize, type GraphState } from '../../../src/agents/index.js';
import {
  createInitialState,
  LeadInputSchema,
  type GuardFinding,
} from '../../../src/contracts/index.js';
import {
  company,
  draftReply,
  qualificationResult,
  requirements,
  scoring,
  TRACE_ID,
  validLead,
} from '../../fixtures/contracts.js';

const config = { maxSteps: 12, maxRewrites: 1 };
const violation: GuardFinding = {
  guard: 'policy',
  code: 'price_promise',
  severity: 'critical',
  message: 'Draft mentions a price',
};

const state = (patch: Partial<GraphState> = {}): GraphState => ({
  ...createInitialState(TRACE_ID, LeadInputSchema.parse(validLead)),
  inputVerdict: 'pass',
  ...patch,
});

const researched = { requirements, company };
const matched = { ...researched, scoring };
const drafted = { ...matched, draft: draftReply };

describe('nextStep', () => {
  it.each<[string, Partial<GraphState>, string]>([
    ['fresh lead', {}, 'research'],
    ['spam', { inputVerdict: 'reject' }, 'finalize'],
    ['research failed', { researchFailed: true }, 'finalize'],
    ['researched', researched, 'matching'],
    ['scored', matched, 'writer'],
    ['writer failed', { ...matched, writerFailed: true }, 'finalize'],
    ['drafted', drafted, 'policy_guard'],
    ['clean draft', { ...drafted, policyChecked: true }, 'finalize'],
    [
      'violation, rewrite left',
      { ...drafted, policyChecked: true, draftFindings: [violation] },
      'writer',
    ],
    [
      'violation after rewrite',
      { ...drafted, policyChecked: true, draftFindings: [violation], rewrites: 1 },
      'finalize',
    ],
  ])('%s → %s', (_name, patch, next) => {
    expect(nextStep(state(patch), config).next).toBe(next);
  });

  it('stops at the step limit with a finding, whatever is left to do', () => {
    const plan = nextStep(state({ steps: 12 }), config);
    expect(plan).toMatchObject({ next: 'finalize', findings: [{ code: 'step_limit_reached' }] });
  });

  it('finalizes once the time budget is spent, before anything else', () => {
    const plan = nextStep(state({ deadline: 1_000 }), config, 1_000);
    expect(plan).toMatchObject({
      next: 'finalize',
      findings: [{ code: 'time_budget_exceeded' }],
    });
    expect(nextStep(state({ deadline: 1_000 }), config, 999).next).toBe('research');
  });

  it('explains every decision', () => {
    expect(nextStep(state(researched), config).reason).toBe('lead not matched and scored yet');
  });
});

describe('summarize', () => {
  const { leadId: _leadId, summary: _summary, ...outcome } = qualificationResult;

  it('describes an auto-reply', () => {
    expect(summarize(outcome)).toBe(
      'Hot lead (95/100): mobile app, budget ≈ $30k, 1 similar case. Auto-reply drafted.',
    );
  });

  it('lists the reasons for human review, ignoring info findings', () => {
    const review = {
      ...outcome,
      decision: 'human_review' as const,
      status: 'pending_approval' as const,
      guardrails: {
        ...outcome.guardrails,
        findings: [
          { ...violation, code: 'approval_required' as const },
          { ...violation, code: 'unsupported_language' as const, severity: 'info' as const },
        ],
      },
    };
    expect(summarize(review)).toMatch(/Needs human review: approval_required\.$/);
  });
});
