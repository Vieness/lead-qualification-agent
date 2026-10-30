import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ResultView } from '../src/components/ResultView';
import { mockApi, record, trace } from './helpers';

const injection = {
  guard: 'input' as const,
  code: 'prompt_injection' as const,
  severity: 'critical' as const,
  message: 'Lead contains instruction-like text',
};

describe('ResultView', () => {
  it('explains an automatic decision', () => {
    render(<ResultView record={record()} trace={trace} onApproved={() => {}} />);

    expect(screen.getByText('Auto-reply ready')).toBeTruthy();
    expect(screen.getByText(/Completed automatically/)).toBeTruthy();
    expect(screen.getAllByRole('meter')).toHaveLength(5);
    expect(screen.getByText('Your loyalty app project')).toBeTruthy();
    expect(screen.getByText(/No findings/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('highlights an attack and offers approval for a parked lead', () => {
    render(
      <ResultView
        record={record({
          decision: 'human_review',
          status: 'pending_approval',
          guardrails: { injectionDetected: true, findings: [injection], retries: 0 },
        })}
        trace={null}
        onApproved={() => {}}
      />,
    );

    expect(screen.getByText('Needs human review')).toBeTruthy();
    expect(screen.getByText(/⚠ prompt injection/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByText('Loading trace…')).toBeTruthy();
  });

  it('asks for a manual reply instead of approval when there is no draft', () => {
    render(
      <ResultView
        record={record({ decision: 'human_review', status: 'pending_approval', draftReply: null })}
        trace={null}
        onApproved={() => {}}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getByText(/wrote no draft for this lead/)).toBeTruthy();
  });

  it('shows a long tool error as one line with the full text on demand', () => {
    const long = `LLM API error 429: Rate limit reached ${'x'.repeat(200)}\nNeed more tokens? Upgrade`;
    const withError = {
      ...trace,
      toolCalls: trace.toolCalls.map((c, i) => (i === 0 ? { ...c, error: long } : c)),
    };
    render(<ResultView record={record()} trace={withError} onApproved={() => {}} />);

    const summary = screen.getByText(/^LLM API error 429: Rate limit reached x+…$/);
    expect(summary.tagName).toBe('SUMMARY');
    expect(summary.closest('details')?.textContent).toContain('Need more tokens? Upgrade');
  });

  it('approves and hands the updated record back', async () => {
    const approved = { ...record({ status: 'completed' }), approvedAt: '2026-10-29T11:00:00.000Z' };
    mockApi({ [`POST /leads/${approved.result.leadId}/approve`]: () => ({ body: approved }) });
    const onApproved = vi.fn();
    render(
      <ResultView
        record={record({ decision: 'human_review', status: 'pending_approval' })}
        trace={null}
        onApproved={onApproved}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApproved).toHaveBeenCalledWith(approved);
  });

  it('explains a conflict when someone approved first', async () => {
    const pending = record({ decision: 'human_review', status: 'pending_approval' });
    mockApi({
      [`POST /leads/${pending.result.leadId}/approve`]: () => ({
        status: 409,
        body: { error: 'not_pending', message: 'Lead is "completed"' },
      }),
    });
    render(<ResultView record={pending} trace={null} onApproved={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Already handled/);
  });

  it('explains a capped tier', () => {
    render(
      <ResultView
        record={record({
          tier: 'cold',
          tierCap: { tier: 'cold', reasons: ['budget $1k is below the $5k minimum'] },
        })}
        trace={null}
        onApproved={() => {}}
      />,
    );
    expect(
      screen.getByText(/Tier capped at cold: budget \$1k is below the \$5k minimum/),
    ).toBeTruthy();
  });

  it('shows the agent trace: stats, plan and tool calls in order', () => {
    render(<ResultView record={record()} trace={trace} onApproved={() => {}} />);
    const section = screen.getByText('How the agent worked').closest('section') as HTMLElement;

    expect(within(section).getByText('48 ms')).toBeTruthy();
    expect(within(section).getByText('1200 / 300')).toBeTruthy();
    const plan = within(section)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(plan[0]).toMatch(/research — requirements unknown/);
    expect(within(section).getByText('Invalid arguments for search_portfolio')).toBeTruthy();
  });
});
