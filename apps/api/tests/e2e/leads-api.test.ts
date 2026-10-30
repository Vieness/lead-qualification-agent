import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import type { LeadInput, QualificationOutcome } from '../../src/contracts/index.js';
import type { Db } from '../../src/db/client.js';
import { createMemoryDb } from '../../src/db/memory.js';
import { LeadRepository } from '../../src/db/repositories/index.js';

const env = (vars: Record<string, string> = {}) =>
  loadEnv({ LLM_PROVIDER: 'mock', LOG_LEVEL: 'silent', ...vars });

const hotLead = {
  name: 'Olena',
  email: 'olena@brewlane.co',
  company: 'Brewlane Coffee',
  message:
    'We need a loyalty mobile app for our coffee chain, budget $40k, launch in 3 months. Call me at +380 67 123 45 67.',
};
const bigLead = {
  ...hotLead,
  message: 'We need a loyalty mobile app, budget $90k, launch in 4 months.',
};

let app: FastifyInstance;
let db: Db;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  ({ db, close: closeDb } = await createMemoryDb({ seed: true }));
  app = await buildApp(env(), { db });
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

const post = (url: string, payload?: unknown) =>
  app.inject({ method: 'POST', url, payload: payload as object });
const get = (url: string) => app.inject({ method: 'GET', url });

describe('POST /leads', () => {
  it('qualifies a lead and stores it', async () => {
    const res = await post('/leads', hotLead);

    expect(res.statusCode).toBe(201);
    const result = res.json();
    expect(res.headers['x-trace-id']).toBe(result.traceId);
    expect(result).toMatchObject({ decision: 'auto_reply', status: 'completed', tier: 'hot' });
    expect((await get(`/leads/${result.leadId}`)).json().result).toEqual(result);
  });

  it('lists every invalid field', async () => {
    const res = await post('/leads', { ...hotLead, email: 'nope', budget: 5 });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'invalid_input',
      requestId: expect.any(String),
      details: expect.arrayContaining([
        expect.objectContaining({ path: 'email' }),
        expect.objectContaining({ message: expect.stringMatching(/budget/) }),
      ]),
    });
  });

  it('rejects malformed JSON and oversized bodies', async () => {
    const malformed = await app.inject({
      method: 'POST',
      url: '/leads',
      headers: { 'content-type': 'application/json' },
      payload: '{"name":',
    });
    expect(malformed.json()).toMatchObject({ error: 'invalid_json' });

    const empty = await app.inject({
      method: 'POST',
      url: `/leads/${crypto.randomUUID()}/approve`,
      headers: { 'content-type': 'application/json' },
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toMatchObject({ error: 'empty_body' });

    const huge = await post('/leads', { ...hotLead, message: 'a'.repeat(70_000) });
    expect(huge.statusCode).toBe(413);
  });
});

describe('GET /leads', () => {
  it('filters the human review queue by status', async () => {
    const pending = (await post('/leads', bigLead)).json();
    const res = await get('/leads?status=pending_approval&limit=5');

    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<{ result: QualificationOutcome & { leadId: string } }>;
    expect(items.map((i) => i.result.leadId)).toContain(pending.leadId);
    expect(items.every((i) => i.result.status === 'pending_approval')).toBe(true);
  });

  it('validates query parameters', async () => {
    expect((await get('/leads?limit=500')).statusCode).toBe(400);
    expect((await get('/leads?status=unknown')).statusCode).toBe(400);
  });

  it('returns 404 for an unknown lead and 400 for a malformed id', async () => {
    expect((await get(`/leads/${crypto.randomUUID()}`)).statusCode).toBe(404);
    expect((await get('/leads/not-a-uuid')).json()).toMatchObject({ error: 'invalid_input' });
  });
});

describe('POST /leads/:id/approve', () => {
  it('approves a pending lead once', async () => {
    const pending = (await post('/leads', bigLead)).json();

    const approved = await post(`/leads/${pending.leadId}/approve`);
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({
      result: { status: 'approved' },
      approvedAt: expect.any(String),
    });

    const again = await post(`/leads/${pending.leadId}/approve`);
    expect(again.statusCode).toBe(409);
    expect(again.json().message).toMatch(/"approved", not waiting for approval/);

    expect((await post(`/leads/${crypto.randomUUID()}/approve`)).statusCode).toBe(404);
  });

  it('refuses to approve a lead without a draft', async () => {
    const parked = (await post('/leads', bigLead)).json();
    const { leadId: _id, ...outcome } = parked;
    const noDraft = await new LeadRepository(db).create(
      { name: 'A', email: 'a@acme.io', message: 'x'.repeat(30), source: 'web_form' },
      { ...outcome, draftReply: null },
    );

    const res = await post(`/leads/${noDraft.leadId}/approve`);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'no_draft' });
  });
});

describe('GET /runs/:traceId/trace', () => {
  it('returns the plan and the masked tool calls in order', async () => {
    const { traceId, leadId } = (await post('/leads', hotLead)).json();
    const res = await get(`/runs/${traceId}/trace`);

    expect(res.statusCode).toBe(200);
    const { run, toolCalls } = res.json();
    expect(run).toMatchObject({ traceId, leadId, status: 'completed', llmProvider: 'mock' });
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
    expect(run.usage.inputTokens).toBeGreaterThan(0);
    expect(run.events.filter((e: { type: string }) => e.type === 'llm_call')).toHaveLength(4);
    expect(run.routeLog.map((r: { next: string }) => r.next)).toEqual([
      'research',
      'matching',
      'writer',
      'policy_guard',
      'finalize',
    ]);
    expect(toolCalls.map((c: { tool: string }) => c.tool)).toEqual([
      'extract_requirements',
      'enrich_company',
      'search_portfolio',
      'search_portfolio',
      'score_lead',
      'draft_reply',
      'save_to_crm',
    ]);

    const stored = JSON.stringify(toolCalls);
    expect(stored).not.toContain('olena@brewlane.co');
    expect(stored).not.toContain('123 45 67');
    expect(stored).toContain('[email]@brewlane.co');
  });

  it('returns 404 for an unknown run', async () => {
    expect((await get(`/runs/${crypto.randomUUID()}/trace`)).statusCode).toBe(404);
  });
});

describe('failures', () => {
  class BrokenLeads extends LeadRepository {
    override async create(_lead: LeadInput, _outcome: QualificationOutcome): Promise<never> {
      throw new Error('connection reset by peer');
    }
  }

  it('answers 500 without internals and records the run as failed', async () => {
    // Swap in a repository whose writes fail, as if the database went away mid-run
    const failing = await buildApp(env(), { db, leads: new BrokenLeads(db) });

    const res = await failing.inject({ method: 'POST', url: '/leads', payload: hotLead });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: 'internal_error',
      message: expect.stringMatching(/requestId/),
      requestId: expect.any(String),
    });
    expect(res.body).not.toContain('connection reset');

    const runs = await db.query.agentRuns.findMany();
    const failed = runs.find((r) => r.status === 'failed');
    expect(failed?.error).toMatch(/Saving the lead failed: connection reset by peer/);
    await failing.close();
  });
});

describe('health and API key', () => {
  it('reports database and provider status', async () => {
    expect((await get('/health')).json()).toEqual({
      status: 'ok',
      db: 'ok',
      storage: 'postgres',
      llmProvider: 'mock',
    });
  });

  it('protects every endpoint except /health when API_KEY is set', async () => {
    const key = 'k'.repeat(32);
    const secured = await buildApp(env({ API_KEY: key }), { db });

    expect((await secured.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await secured.inject({ method: 'GET', url: '/leads' })).statusCode).toBe(401);
    expect(
      (await secured.inject({ method: 'GET', url: '/leads', headers: { 'x-api-key': 'wrong' } }))
        .statusCode,
    ).toBe(401);
    expect(
      (await secured.inject({ method: 'GET', url: '/leads', headers: { 'x-api-key': key } }))
        .statusCode,
    ).toBe(200);
    await secured.close();
  });

  it('answers unknown routes with the common error shape', async () => {
    expect((await get('/nope')).json()).toMatchObject({ error: 'not_found' });
  });
});
