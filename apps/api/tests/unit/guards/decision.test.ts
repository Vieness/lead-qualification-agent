import { describe, expect, it } from 'vitest';
import type {
  GuardCode,
  GuardFinding,
  QualificationOutcome,
} from '../../../src/contracts/index.js';
import { decide, enforceOutcome, findInconsistencies } from '../../../src/guards/index.js';
import { qualificationResult } from '../../fixtures/contracts.js';

const finding = (code: GuardCode): GuardFinding => ({
  guard: 'policy',
  code,
  severity: 'warning',
  message: code,
});

describe('decide', () => {
  it.each<[GuardCode[], boolean, string, string]>([
    [[], true, 'auto_reply', 'completed'],
    [['pii_detected', 'unsupported_language'], true, 'auto_reply', 'completed'],
    [[], false, 'human_review', 'pending_approval'],
    [['prompt_injection'], true, 'human_review', 'pending_approval'],
    [['approval_required'], true, 'human_review', 'pending_approval'],
    [['price_promise'], true, 'human_review', 'pending_approval'],
    [['llm_unavailable'], false, 'human_review', 'pending_approval'],
    [['step_limit_reached'], true, 'human_review', 'pending_approval'],
    [['spam'], false, 'reject', 'rejected'],
    [['spam', 'prompt_injection'], false, 'reject', 'rejected'],
  ])('%o with draft=%s → %s', (codes, hasDraft, decision, status) => {
    expect(decide({ findings: codes.map(finding), hasDraft })).toEqual({ decision, status });
  });
});

describe('output guard', () => {
  const { leadId: _leadId, ...valid } = qualificationResult;

  it('passes a consistent outcome unchanged', () => {
    expect(findInconsistencies(valid)).toEqual([]);
    expect(enforceOutcome(valid)).toEqual(valid);
  });

  it.each<[string, Partial<QualificationOutcome>, RegExp]>([
    ['auto reply without draft', { draftReply: null }, /auto_reply without a draft/],
    ['wrong score', { score: 50 }, /differs from breakdown sum/],
    ['wrong tier', { tier: 'cold' }, /tier "cold" does not match/],
    ['status mismatch', { status: 'rejected' }, /does not match decision/],
    ['spam not rejected', { tier: 'spam' }, /spam tier must be rejected/],
  ])('downgrades %s to human review', (_name, patch, problem) => {
    const enforced = enforceOutcome({ ...valid, ...patch });
    expect(enforced).toMatchObject({ decision: 'human_review', status: 'pending_approval' });
    expect(enforced.guardrails.findings.at(-1)).toMatchObject({
      guard: 'output',
      code: 'inconsistent_outcome',
      message: expect.stringMatching(problem),
    });
  });

  it('accepts a capped cold tier and rejects a cap that was ignored', () => {
    const tierCap = { tier: 'cold' as const, reasons: ['budget $1k is below the $5k minimum'] };
    expect(findInconsistencies({ ...valid, tier: 'cold', tierCap })).toEqual([]);
    expect(findInconsistencies({ ...valid, tierCap })).toEqual([
      'tier "hot" does not match score 95',
    ]);
  });

  it('throws on a schema violation, which is a bug', () => {
    expect(() => enforceOutcome({ ...valid, score: 101 })).toThrow();
  });
});
