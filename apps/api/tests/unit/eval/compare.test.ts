import { describe, expect, it } from 'vitest';
import { compare } from '../../../src/eval/compare.js';
import { ExpectationSchema, type Expectation } from '../../../src/eval/expectations.js';
import {
  caseStability,
  computeMetrics,
  renderMarkdown,
  type CaseResult,
} from '../../../src/eval/report.js';
import { qualificationResult as result } from '../../fixtures/contracts.js';

const base: Expectation = { decision: 'auto_reply', status: 'completed' };
const observed = { result, llmCalls: 4 };

describe('compare', () => {
  it('passes when every stated expectation holds', () => {
    expect(
      compare(observed, {
        ...base,
        tier: ['hot'],
        score: { min: 90, max: 100 },
        scoreRules: { budget_fit: { min: 30 } },
        findingsExclude: ['prompt_injection'],
        injectionDetected: false,
        replyLanguage: 'en',
        minMatchedCases: 1,
        maxLlmCalls: 4,
      }),
    ).toEqual([]);
  });

  it('lists every mismatch in plain words', () => {
    expect(
      compare(observed, {
        decision: 'human_review',
        status: 'pending_approval',
        tier: ['cold', 'warm'],
        score: { max: 39 },
        scoreRules: { company_signal: { max: 0 } },
        findingsInclude: ['approval_required'],
        replyLanguage: 'uk',
        minMatchedCases: 2,
        maxLlmCalls: 0,
      }),
    ).toEqual([
      'decision auto_reply, expected human_review',
      'status completed, expected pending_approval',
      'tier hot, expected cold or warm',
      'score 95, expected -∞..39',
      'company_signal 15 points, expected -∞..0',
      'missing finding approval_required',
      'reply language en, expected uk',
      '1 matched cases, expected ≥ 2',
      '4 LLM calls, expected ≤ 0',
    ]);
  });

  it('rejects malformed expectation files', () => {
    expect(ExpectationSchema.safeParse({ ...base, tier: 'hot' }).success).toBe(false);
    expect(ExpectationSchema.safeParse({ ...base, score: { min: 5, max: 1 } }).success).toBe(false);
    expect(ExpectationSchema.safeParse({ ...base, unknown: 1 }).success).toBe(false);
  });
});

describe('metrics and report', () => {
  const row = (patch: Partial<CaseResult>): CaseResult => ({
    id: 'x',
    run: 1,
    attack: false,
    description: undefined,
    passed: true,
    problems: [],
    result: {
      decision: 'auto_reply',
      status: 'completed',
      tier: 'hot',
      score: 80,
      traceId: result.traceId,
      summary: 's',
      injectionDetected: false,
      replyLanguage: 'en',
    },
    expected: { ...base, tier: ['hot'], score: { min: 70 } },
    durationMs: 10,
    llmCalls: 4,
    tokens: { inputTokens: 100, outputTokens: 20 },
    ...patch,
  });

  it('computes accuracy, attack detection and false alarms', () => {
    const metrics = computeMetrics([
      row({}),
      row({ id: 'fp', result: { ...row({}).result, injectionDetected: true }, passed: false }),
      row({ id: 'a1', attack: true, result: { ...row({}).result, injectionDetected: true } }),
      row({ id: 'a2', attack: true }),
    ]);
    expect(metrics).toMatchObject({
      cases: 4,
      runs: 1,
      passed: 3,
      stableCases: 3,
      passRate: 0.75,
      decisionAccuracy: 1,
      attackDetection: 0.5,
      falsePositiveRate: 0.5,
      avgLlmCalls: 4,
    });
  });

  it('renders a markdown report with a row per case', () => {
    const md = renderMarkdown(computeMetrics([row({})]), [row({})], {
      provider: 'mock',
      model: 'mock',
      date: '2026-10-29',
    });
    expect(md).toMatch(/^# Eval report/);
    expect(md).toContain('| Cases passed | 1/1 (100%) |');
    expect(md).toContain('| ✅ | `x` | auto_reply | hot | 80 |');
  });

  describe('with repeated runs', () => {
    const flaky = row({ id: 'flaky', run: 2, passed: false, problems: ['decision human_review'] });
    const results = [
      row({ id: 'steady' }),
      row({ id: 'flaky' }),
      row({ id: 'steady', run: 2 }),
      flaky,
      row({ id: 'steady', run: 3 }),
      { ...flaky, run: 3 },
    ];

    it('rates every run and counts cases that passed all of them', () => {
      expect(computeMetrics(results)).toMatchObject({
        cases: 2,
        runs: 3,
        passed: 4,
        passRate: 4 / 6,
        stableCases: 1,
      });
    });

    it('reports per-case stability with each problem once', () => {
      expect(caseStability(results)).toEqual([
        { id: 'steady', passed: 3, runs: 3, problems: [] },
        { id: 'flaky', passed: 1, runs: 3, problems: ['decision human_review'] },
      ]);
    });

    it('adds a stability table and run numbers to the report', () => {
      const md = renderMarkdown(computeMetrics(results), results, {
        provider: 'mock',
        model: 'mock',
        date: '2026-10-29',
      });
      expect(md).toContain('| Case runs passed | 4/6 (66.7%) |');
      expect(md).toContain('| Cases passing every run | 1/2 |');
      expect(md).toContain('| ⚠️ | `flaky` | 1/3 | decision human_review |');
      expect(md).toContain('| ❌ | `flaky` #2 |');
      expect(md).not.toContain('| Cases passed |');
    });
  });
});
