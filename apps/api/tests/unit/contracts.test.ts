import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AgentStateSchema,
  BudgetSchema,
  createInitialState,
  LeadInputSchema,
  MatchedCaseSchema,
  QualificationResultSchema,
  RequirementsSchema,
  ScoreBreakdownItemSchema,
  ScoreLeadOutputSchema,
  SearchPortfolioInputSchema,
  ToolCallRecordSchema,
  agentToolSchemas,
} from '../../src/contracts/index.js';
import {
  TRACE_ID,
  matchedCase,
  qualificationResult,
  requirements,
  scoring,
  validLead,
} from '../fixtures/contracts.js';

describe('LeadInputSchema', () => {
  it('accepts a valid lead and normalizes it', () => {
    const lead = LeadInputSchema.parse({ ...validLead, email: '  Olena@ACME.io ' });

    expect(lead.email).toBe('olena@acme.io');
    expect(lead.website).toBe('acme.io');
    expect(lead.source).toBe('web_form');
  });

  it.each([
    ['invalid email', { email: 'not-an-email' }],
    ['message under 20 chars', { message: 'Need an app' }],
    ['message over 5000 chars', { message: 'a'.repeat(5001) }],
    ['whitespace-only name', { name: '   ' }],
    ['invalid website', { website: 'not a site' }],
    ['unknown field', { budget: 30000 }],
  ])('rejects %s', (_case, patch) => {
    expect(LeadInputSchema.safeParse({ ...validLead, ...patch }).success).toBe(false);
  });

  it('counts the message length after trimming', () => {
    const padded = `   ${'a'.repeat(19)}   `;
    expect(LeadInputSchema.safeParse({ ...validLead, message: padded }).success).toBe(false);
  });
});

describe('LLM-filled schemas', () => {
  it('strips unknown keys instead of failing', () => {
    const parsed = RequirementsSchema.parse({ ...requirements, confidence: 0.9 });
    expect(parsed).not.toHaveProperty('confidence');
  });

  it('still rejects wrong types and missing required fields', () => {
    expect(RequirementsSchema.safeParse({ ...requirements, services: 'mobile' }).success).toBe(
      false,
    );
    const withoutLanguage: Partial<typeof requirements> = { ...requirements };
    delete withoutLanguage.language;
    expect(RequirementsSchema.safeParse(withoutLanguage).success).toBe(false);
  });

  it('validates budget consistency', () => {
    const base = { currency: 'USD', raw: '' } as const;
    expect(BudgetSchema.safeParse({ ...base, min: 10, max: 5 }).success).toBe(false);
    expect(BudgetSchema.safeParse({ ...base, min: null, max: null }).success).toBe(false);
    expect(BudgetSchema.safeParse({ ...base, min: null, max: 5000 }).success).toBe(true);
  });
});

describe('boundaries', () => {
  it.each([-1, 101, 50.5])('rejects score %s', (score) => {
    expect(ScoreLeadOutputSchema.safeParse({ ...scoring, score }).success).toBe(false);
  });

  it.each([-0.01, 1.01])('rejects relevance %s', (relevance) => {
    expect(MatchedCaseSchema.safeParse({ ...matchedCase, relevance }).success).toBe(false);
  });

  it.each([0, 6])('rejects portfolio limit %s', (limit) => {
    const input = { query: 'loyalty app', services: ['mobile'], limit };
    expect(SearchPortfolioInputSchema.safeParse(input).success).toBe(false);
  });

  it('rejects breakdown points above the rule maximum', () => {
    const item = { rule: 'budget_fit', points: 31, max: 30, reason: 'too many' };
    expect(ScoreBreakdownItemSchema.safeParse(item).success).toBe(false);
  });
});

describe('QualificationResultSchema', () => {
  it('accepts a complete example result', () => {
    expect(QualificationResultSchema.parse(qualificationResult)).toEqual(qualificationResult);
  });

  it('allows a rejected lead without research data', () => {
    const rejected = {
      ...qualificationResult,
      status: 'rejected',
      decision: 'reject',
      tier: 'spam',
      score: 0,
      requirements: null,
      company: null,
      matchedCases: [],
      scoreBreakdown: [],
      draftReply: null,
    };
    expect(QualificationResultSchema.safeParse(rejected).success).toBe(true);
  });
});

describe('AgentState and trace', () => {
  it('creates a valid initial state', () => {
    const lead = LeadInputSchema.parse(validLead);
    expect(() => AgentStateSchema.parse(createInitialState(TRACE_ID, lead))).not.toThrow();
  });

  it('rejects a tool call record with both result and error', () => {
    const record = {
      traceId: TRACE_ID,
      step: 1,
      agent: 'research',
      tool: 'enrich_company',
      args: {},
      result: { found: false },
      error: 'timeout',
      latencyMs: 120,
      startedAt: new Date().toISOString(),
    };
    expect(ToolCallRecordSchema.safeParse(record).success).toBe(false);
    expect(ToolCallRecordSchema.safeParse({ ...record, result: null }).success).toBe(true);
  });
});

describe('tool schemas for function calling', () => {
  it.each(Object.entries(agentToolSchemas))(
    '%s input converts to an object JSON Schema',
    (_name, { input }) => {
      const schema = z.toJSONSchema(input, { io: 'input' });
      expect(schema.type).toBe('object');
      expect(schema.properties).toBeDefined();
    },
  );
});
