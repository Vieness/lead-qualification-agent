import { vi } from 'vitest';
import { qualificationResult } from '../../api/tests/fixtures/contracts';
import type { LeadRecord, Trace } from '../src/types';

export const result = qualificationResult;

export const record = (patch: Partial<LeadRecord['result']> = {}): LeadRecord => ({
  lead: {
    name: 'Olena',
    email: 'olena@acme.io',
    company: 'Acme',
    message: 'We need a loyalty app',
    source: 'web_form',
  },
  result: { ...result, ...patch },
  approvedAt: null,
  createdAt: '2026-10-29T10:00:00.000Z',
});

export const trace: Trace = {
  run: {
    traceId: result.traceId,
    leadId: result.leadId,
    status: 'completed',
    llmProvider: 'mock',
    model: 'mock',
    steps: 5,
    retries: 0,
    findings: [],
    routeLog: [
      { step: 0, next: 'research', reason: 'requirements unknown' },
      { step: 1, next: 'matching', reason: 'lead not matched and scored yet' },
      { step: 2, next: 'finalize', reason: 'all steps done' },
    ],
    notes: [],
    usage: { inputTokens: 1200, outputTokens: 300 },
    durationMs: 48,
    events: [],
    error: null,
    startedAt: '2026-10-29T10:00:00.000Z',
    finishedAt: '2026-10-29T10:00:00.048Z',
  },
  toolCalls: [
    {
      traceId: result.traceId,
      step: 0,
      agent: 'research',
      tool: 'extract_requirements',
      args: {},
      result: {},
      error: null,
      latencyMs: 12,
      startedAt: '2026-10-29T10:00:00.000Z',
    },
    {
      traceId: result.traceId,
      step: 1,
      agent: 'matching',
      tool: 'search_portfolio',
      args: {},
      result: null,
      error: 'Invalid arguments for search_portfolio',
      latencyMs: 3,
      startedAt: '2026-10-29T10:00:00.010Z',
    },
  ],
};

type Handler = (
  body: unknown,
) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;

/** Stubs fetch with handlers keyed by "METHOD /path" (query string ignored). */
export function mockApi(routes: Record<string, Handler>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = url.replace(/^\/api/, '').split('?')[0];
    const handler = routes[`${method} ${path}`];
    if (!handler)
      return new Response(JSON.stringify({ error: 'not_found', message: 'no mock' }), {
        status: 404,
      });
    const { status = 200, body } = await handler(
      init?.body ? JSON.parse(String(init.body)) : undefined,
    );
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
