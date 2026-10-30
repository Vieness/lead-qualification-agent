import { describe, expect, it } from 'vitest';
import type { ScoreLeadInput } from '../../../src/contracts/index.js';
import { budgetToUsd, scoreLead, tierFor } from '../../../src/tools/index.js';
import { company, requirements, scoring } from '../../fixtures/contracts.js';

const base: ScoreLeadInput = { requirements, company, matchedCasesCount: 1 };

function points(input: ScoreLeadInput, rule: string): number | undefined {
  return scoreLead(input).breakdown.find((b) => b.rule === rule)?.points;
}

function withBudget(max: number | null, currency: 'USD' | 'EUR' | 'UAH' = 'USD'): ScoreLeadInput {
  return {
    ...base,
    requirements: {
      ...requirements,
      budget: max === null ? null : { min: null, max, currency, raw: '' },
    },
  };
}

describe('scoreLead', () => {
  it('matches the shared fixture used across tests', () => {
    expect(scoreLead(base)).toEqual(scoring);
  });

  it('scores the reference hot lead with a full breakdown', () => {
    const result = scoreLead(base);
    expect(result.breakdown.map((b) => [b.rule, b.points])).toEqual([
      ['budget_fit', 30],
      ['service_fit', 20],
      ['completeness', 15],
      ['timeline_realism', 15],
      ['company_signal', 15],
    ]);
    expect(result).toMatchObject({ score: 95, tier: 'hot' });
  });

  it.each([
    [4_999, 0],
    [5_000, 10],
    [10_000, 20],
    [25_000, 30],
    [150_000, 25],
    [null, 5],
  ])('budget %s USD gives %i points', (max, expected) => {
    expect(points(withBudget(max), 'budget_fit')).toBe(expected);
  });

  it('converts other currencies before applying budget bands', () => {
    expect(budgetToUsd({ min: null, max: 30_000, currency: 'EUR', raw: '' })).toBe(32_400);
    expect(points(withBudget(500_000, 'UAH'), 'budget_fit')).toBe(20);
  });

  it.each([
    [1, 0],
    [2, 7],
    [4, 15],
    [52, 15],
    [53, 10],
    [null, 7],
  ])('timeline of %s weeks gives %i points', (weeks, expected) => {
    const input = {
      ...base,
      requirements: { ...requirements, timeline: weeks === null ? null : { raw: '', weeks } },
    };
    expect(points(input, 'timeline_realism')).toBe(expected);
  });

  it.each([
    [['mobile', 'design'], 2, 25],
    [['web', 'other'], 0, 8],
    [['other'], 1, 5],
    [[], 3, 5],
  ] as const)('services %o with %i cases give %i points', (services, cases, expected) => {
    const input = {
      requirements: { ...requirements, services: [...services] },
      company,
      matchedCasesCount: cases,
    };
    expect(points(input, 'service_fit')).toBe(expected);
  });

  it('penalises missing budget, timeline and scope but not company', () => {
    const missing = (list: ScoreLeadInput['requirements']['missingInfo']) => ({
      ...base,
      requirements: { ...requirements, missingInfo: list },
    });
    expect(points(missing(['budget', 'timeline']), 'completeness')).toBe(5);
    expect(points(missing(['budget', 'timeline', 'scope']), 'completeness')).toBe(0);
    expect(points(missing(['company']), 'completeness')).toBe(15);
  });

  it.each([
    [{ ...company, size: '1-10' as const }, 5],
    [{ ...company, found: false, size: null }, 5],
    [{ ...company, found: false, size: null, domain: null }, 0],
  ])('company signal for %o is %i', (profile, expected) => {
    expect(points({ ...base, company: profile }, 'company_signal')).toBe(expected);
  });

  it('always reports the sum of the breakdown as the score', () => {
    for (const max of [null, 3_000, 12_000, 200_000]) {
      for (const cases of [0, 1, 3]) {
        const result = scoreLead({ ...withBudget(max), matchedCasesCount: cases });
        const sum = result.breakdown.reduce((total, b) => total + b.points, 0);
        expect(result.score).toBe(sum);
        expect(result.breakdown.every((b) => b.points <= b.max)).toBe(true);
      }
    }
  });
});

describe('viability gate', () => {
  const strong = { ...base, matchedCasesCount: 3 };
  const withTimeline = (weeks: number | null) => ({
    ...strong,
    requirements: { ...requirements, timeline: weeks === null ? null : { raw: '', weeks } },
  });

  it('caps a budget below $5k at cold even when the rest scores warm', () => {
    const result = scoreLead({ ...withBudget(4_999), matchedCasesCount: 3 });
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result).toMatchObject({
      tier: 'cold',
      tierCap: { tier: 'cold', reasons: ['budget $4,999 is below the $5,000 minimum'] },
    });
  });

  it('does not cap at the $5k minimum or when the budget is unknown', () => {
    expect(scoreLead({ ...withBudget(5_000), matchedCasesCount: 3 }).tierCap).toBeNull();
    expect(scoreLead({ ...withBudget(null), matchedCasesCount: 3 }).tierCap).toBeNull();
  });

  it('caps an impossible deadline, not a tight one or an unknown one', () => {
    expect(scoreLead(withTimeline(1))).toMatchObject({
      tier: 'cold',
      tierCap: { reasons: ['a timeline of 1 week is not realistic'] },
    });
    expect(scoreLead(withTimeline(2)).tierCap).toBeNull();
    expect(scoreLead(withTimeline(null)).tierCap).toBeNull();
  });

  it('lists every deal-breaker and keeps the points unchanged', () => {
    const input = {
      ...withTimeline(1),
      requirements: {
        ...withTimeline(1).requirements,
        budget: { min: null, max: 500, currency: 'USD' as const, raw: '' },
      },
    };
    const result = scoreLead(input);
    expect(result.tierCap?.reasons).toHaveLength(2);
    expect(result.score).toBe(result.breakdown.reduce((sum, b) => sum + b.points, 0));
  });
});

describe('tierFor', () => {
  it.each([
    [0, 'cold'],
    [39, 'cold'],
    [40, 'warm'],
    [69, 'warm'],
    [70, 'hot'],
    [100, 'hot'],
  ])('score %i is %s', (score, tier) => {
    expect(tierFor(score)).toBe(tier);
  });
});
