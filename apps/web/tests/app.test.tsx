import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';
import { ReviewQueue } from '../src/components/ReviewQueue';
import { parseHash } from '../src/hooks/useHashRoute';
import { mockApi, record, result, trace } from './helpers';

const health = { status: 'ok', db: 'ok', storage: 'postgres', llmProvider: 'mock' };

describe('parseHash', () => {
  it.each([
    ['', { page: 'new' }],
    ['#/queue', { page: 'queue' }],
    [`#/leads/${result.leadId}`, { page: 'lead', id: result.leadId }],
    ['#/leads/not-an-id', { page: 'new' }],
  ])('%s', (hash, route) => {
    expect(parseHash(hash)).toEqual(route);
  });
});

describe('App', () => {
  it('opens a lead from its link with the result and the trace', async () => {
    mockApi({
      'GET /health': () => ({ body: health }),
      [`GET /leads/${result.leadId}`]: () => ({ body: record() }),
      [`GET /runs/${result.traceId}/trace`]: () => ({ body: trace }),
    });
    window.location.hash = `#/leads/${result.leadId}`;
    render(<App />);

    expect(await screen.findByText('Auto-reply ready')).toBeTruthy();
    expect(await screen.findByText('48 ms')).toBeTruthy();
    expect(await screen.findByText(/API online · LLM: mock/)).toBeTruthy();
  });

  it('says so when a lead does not exist', async () => {
    mockApi({ 'GET /health': () => ({ body: health }) });
    window.location.hash = `#/leads/${result.leadId}`;
    render(<App />);
    expect(await screen.findByText('This lead does not exist.')).toBeTruthy();
  });

  it('navigates to the queue tab', async () => {
    mockApi({
      'GET /health': () => ({ body: health }),
      'GET /leads': () => ({ body: { items: [] } }),
    });
    render(<App />);
    await userEvent.click(screen.getByRole('link', { name: 'Review queue' }));
    expect(await screen.findByText(/Nothing waiting for review/)).toBeTruthy();
  });
});

describe('ReviewQueue', () => {
  it('lists parked leads with the reasons', async () => {
    const parked = record({
      decision: 'human_review',
      status: 'pending_approval',
      guardrails: {
        injectionDetected: false,
        retries: 0,
        findings: [
          { guard: 'policy', code: 'approval_required', severity: 'warning', message: 'big' },
        ],
      },
    });
    mockApi({ 'GET /leads': () => ({ body: { items: [parked] } }) });
    render(<ReviewQueue />);

    expect(await screen.findByRole('link', { name: 'Acme' })).toBeTruthy();
    expect(screen.getByText(/Why: approval required/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
  });

  it('shows API errors', async () => {
    mockApi({});
    render(<ReviewQueue />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/no mock/);
  });
});
