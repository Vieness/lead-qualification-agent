import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDemoMockProvider,
  detectLanguage,
  heuristicRequirements,
  parseBudget,
  parseTimeline,
} from '../../../src/llm/demo-mock.js';
import {
  draftReplyTool,
  extractRequirementsTool,
  runTool,
  type ToolContext,
} from '../../../src/tools/index.js';
import { matchedCase } from '../../fixtures/contracts.js';
import { createToolContext } from '../../helpers/tool-context.js';

describe('parseBudget', () => {
  it.each([
    ['budget ~$30k', { min: 30_000, max: 30_000, currency: 'USD' }],
    ['between 20-40k EUR', { min: 20_000, max: 40_000, currency: 'EUR' }],
    ['around €20 000 total', { min: 20_000, max: 20_000, currency: 'EUR' }],
    ['up to $10k', { min: null, max: 10_000, currency: 'USD' }],
    ['бюджет 50 тис. грн', { min: 50_000, max: 50_000, currency: 'UAH' }],
    ['£15,000 for the brand', { min: 15_000, max: 15_000, currency: 'GBP' }],
    ['до 300 000 гривень', { min: null, max: 300_000, currency: 'UAH' }],
    ['Budget etwa 15.000 EUR', { min: 15_000, max: 15_000, currency: 'EUR' }],
    ['бюджет 2,5 млн грн', { min: 2_500_000, max: 2_500_000, currency: 'UAH' }],
    ['$1.5k for a logo', { min: 1_500, max: 1_500, currency: 'USD' }],
  ])('parses "%s"', (text, expected) => {
    expect(parseBudget(text)).toMatchObject(expected);
  });

  it('returns null without an amount and currency', () => {
    expect(parseBudget('We have 3 stores and 20 people')).toBeNull();
  });
});

describe('parseTimeline', () => {
  it.each([
    ['launch in Q2', 12],
    ['ready in 6 weeks', 6],
    ['за 3 місяці', 13],
    ['протягом 8 тижнів', 8],
    ['we need it ASAP', 1],
    ['Start in 3 Monaten', 13],
  ])('parses "%s" as %i weeks', (text, weeks) => {
    expect(parseTimeline(text)?.weeks).toBe(weeks);
  });

  it('returns null without a timeline', () => {
    expect(parseTimeline('Just exploring options')).toBeNull();
  });
});

describe('detectLanguage', () => {
  it.each([
    ['Потрібен сайт', 'uk'],
    ['Wir brauchen eine neue Website für unsere Firma', 'de'],
    ['We need a website for the die-cast toy shop', 'en'],
  ])('"%s" → %s', (text, language) => {
    expect(detectLanguage(text)).toBe(language);
  });
});

describe('heuristicRequirements', () => {
  it('reads a Ukrainian lead', () => {
    const result = heuristicRequirements(
      'Потрібен мобільний застосунок для програми лояльності. Бюджет 40 тис. євро.',
    );
    expect(result).toMatchObject({
      language: 'uk',
      projectType: 'mobile_app',
      services: ['mobile'],
      budget: { max: 40_000, currency: 'EUR' },
      missingInfo: ['timeline'],
    });
  });

  it('flags a vague lead as missing everything', () => {
    expect(heuristicRequirements('Hello, can we talk?').missingInfo).toEqual([
      'budget',
      'timeline',
      'scope',
    ]);
  });
});

describe('demo mock through the real tools', () => {
  let ctx: ToolContext;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ ctx, close } = await createToolContext({ llm: createDemoMockProvider() }));
  });
  afterAll(() => close());

  it('produces schema-valid requirements', async () => {
    const run = await runTool(
      extractRequirementsTool,
      { message: 'We need an e-commerce website, budget $50k, launch in 3 months.' },
      ctx,
    );
    expect(run).toMatchObject({
      ok: true,
      result: { projectType: 'ecommerce', budget: { max: 50_000 }, timeline: { weeks: 13 } },
    });
  });

  it('writes a Ukrainian reply with cases and questions, without prices', async () => {
    const run = await runTool(
      draftReplyTool,
      {
        leadName: 'Олена',
        language: 'uk',
        requirements: heuristicRequirements('Потрібен мобільний застосунок'),
        matchedCases: [matchedCase],
        tier: 'warm',
        missingInfo: ['budget'],
        policyFeedback: [],
      },
      ctx,
    );
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.result.body).toContain('Вітаємо, Олена!');
    expect(run.result.body).toContain(matchedCase.title);
    expect(run.result.body).toContain('орієнтовний бюджет');
    expect(run.result.body).not.toMatch(/[$€]\s?\d/);
  });
});
