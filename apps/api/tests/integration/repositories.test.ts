import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LeadInputSchema, type ToolCallRecord } from '../../src/contracts/index.js';
import type { Db } from '../../src/db/client.js';
import { DEFAULT_PORTFOLIO_DIR } from '../../src/db/paths.js';
import { loadPortfolio } from '../../src/db/portfolio-loader.js';
import {
  LeadRepository,
  PortfolioRepository,
  RunRepository,
} from '../../src/db/repositories/index.js';
import { qualificationResult, validLead } from '../fixtures/contracts.js';
import { createTestDb } from '../helpers/db.js';

const { leadId: _leadId, ...outcome } = qualificationResult;
const lead = LeadInputSchema.parse(validLead);

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});

describe('LeadRepository', () => {
  it('stores a lead and returns the same outcome', async () => {
    const leads = new LeadRepository(db);
    const saved = await leads.create(lead, outcome);

    const found = await leads.findById(saved.leadId);
    expect(found?.lead).toEqual(lead);
    expect(found?.result).toEqual({ ...outcome, leadId: saved.leadId });
    expect(found?.approvedAt).toBeNull();
  });

  it('returns null for an unknown id', async () => {
    expect(await new LeadRepository(db).findById(crypto.randomUUID())).toBeNull();
  });

  it('approves only leads waiting for approval', async () => {
    const leads = new LeadRepository(db);
    const pending = await leads.create(lead, {
      ...outcome,
      status: 'pending_approval',
      decision: 'human_review',
    });

    const approved = await leads.markApproved(pending.leadId);
    expect(approved.status).toBe('approved');
    if (approved.status === 'approved') {
      expect(approved.lead.result.status).toBe('approved');
      expect(approved.lead.approvedAt).toBeInstanceOf(Date);
    }

    expect(await leads.markApproved(pending.leadId)).toEqual({
      status: 'not_pending',
      current: 'approved',
    });
    expect(await leads.markApproved(crypto.randomUUID())).toEqual({ status: 'not_found' });

    const noDraft = await leads.create(lead, {
      ...outcome,
      status: 'pending_approval',
      decision: 'human_review',
      draftReply: null,
    });
    expect(await leads.markApproved(noDraft.leadId)).toEqual({ status: 'no_draft' });
  });
});

describe('RunRepository', () => {
  const call = (traceId: string, step: number): ToolCallRecord => ({
    traceId,
    step,
    agent: 'research',
    tool: 'enrich_company',
    args: { emailDomain: 'acme.io' },
    result: { found: true },
    error: null,
    latencyMs: 12.6,
    startedAt: new Date(Date.UTC(2026, 9, 29, 12, 0, step)).toISOString(),
  });

  it('records tool calls and returns the trace in step order', async () => {
    const runs = new RunRepository(db);
    const traceId = crypto.randomUUID();
    await runs.start({ traceId, llmProvider: 'mock', model: null });

    for (const step of [2, 0, 1]) await runs.recordToolCall(call(traceId, step));
    await runs.finish(traceId, {
      status: 'completed',
      leadId: null,
      steps: 3,
      retries: 1,
      findings: [],
      promptVersions: { research: '1.0.0' },
      routeLog: [{ step: 0, next: 'research', reason: 'requirements unknown' }],
      notes: [],
      usage: { inputTokens: 10, outputTokens: 5 },
      durationMs: 42,
      events: [],
      error: null,
    });

    const trace = await runs.getTrace(traceId);
    expect(trace?.toolCalls.map((c) => c.step)).toEqual([0, 1, 2]);
    expect(trace?.toolCalls[0]?.latencyMs).toBe(13);
    expect(trace?.run.status).toBe('completed');
    expect(trace?.run.finishedAt).toBeInstanceOf(Date);
    expect(trace?.run.routeLog).toHaveLength(1);
  });

  it('rejects a tool call for an unknown run', async () => {
    await expect(
      new RunRepository(db).recordToolCall(call(crypto.randomUUID(), 0)),
    ).rejects.toThrow();
  });

  it('returns null trace for an unknown run', async () => {
    expect(await new RunRepository(db).getTrace(crypto.randomUUID())).toBeNull();
  });
});

describe('portfolio seed and search', () => {
  let portfolio: PortfolioRepository;

  beforeAll(async () => {
    portfolio = new PortfolioRepository(db);
    await portfolio.upsertMany(await loadPortfolio(DEFAULT_PORTFOLIO_DIR));
  });

  it('seeds all case studies and stays idempotent', async () => {
    const cases = await loadPortfolio(DEFAULT_PORTFOLIO_DIR);
    expect(cases).toHaveLength(10);
    await portfolio.upsertMany(cases);
    expect(await portfolio.count()).toBe(10);
  });

  it('ranks the most relevant case first', async () => {
    const hits = await portfolio.search({ query: 'loyalty mobile app', services: [], limit: 3 });
    expect(hits[0]?.id).toBe('loyalty-app-coffee-chain');
    expect(hits[0]?.rank).toBeGreaterThan(hits[1]?.rank ?? 0);
  });

  it('filters by services and respects the limit', async () => {
    const hits = await portfolio.search({
      query: 'app web dashboard automation',
      services: ['ai_automation'],
      limit: 5,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.services.includes('ai_automation'))).toBe(true);

    const limited = await portfolio.search({ query: 'app web design', services: [], limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it('returns nothing for unsearchable or unmatched queries', async () => {
    expect(await portfolio.search({ query: '!!!', services: [], limit: 3 })).toEqual([]);
    expect(await portfolio.search({ query: 'zzzqqq', services: [], limit: 3 })).toEqual([]);
  });
});

describe('loadPortfolio validation', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'portfolio-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('names the file with invalid frontmatter', async () => {
    await writeFile(join(dir, 'broken.md'), '---\nid: Not A Slug\n---\nBody');
    await expect(loadPortfolio(dir)).rejects.toThrow(/broken\.md: invalid frontmatter/);
  });
});
