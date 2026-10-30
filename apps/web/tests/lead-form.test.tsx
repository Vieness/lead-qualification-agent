import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LeadForm } from '../src/components/LeadForm';
import { samples } from '../src/samples';
import { mockApi, result } from './helpers';

describe('LeadForm', () => {
  it('offers the shared samples, attacks marked and listed last', () => {
    render(<LeadForm onResult={() => {}} />);
    expect(samples.length).toBeGreaterThanOrEqual(13);
    expect(screen.getByRole('button', { name: 'Hot lead' })).toBeTruthy();
    const attack = screen.getByRole('button', { name: /Ignore instructions/ });
    expect(attack.className).toContain('chip--attack');
    expect(samples.at(-1)?.attack).toBe(true);
  });

  it('fills the form from a sample', async () => {
    render(<LeadForm onResult={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hot lead' }));

    expect(screen.getByLabelText<HTMLInputElement>('Name').value).toBe('Olena');
    expect(screen.getByLabelText<HTMLTextAreaElement>('Message').value).toMatch(
      /loyalty mobile app/,
    );
  });

  it('submits the lead and returns the result', async () => {
    const fetchMock = mockApi({ 'POST /leads': () => ({ status: 201, body: result }) });
    const onResult = vi.fn();
    render(<LeadForm onResult={onResult} />);

    await userEvent.click(screen.getByRole('button', { name: 'Hot lead' }));
    await userEvent.click(screen.getByRole('button', { name: 'Qualify lead' }));

    expect(onResult).toHaveBeenCalledWith(result);
    const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(sent).toMatchObject({ name: 'Olena', email: 'olena@brewlane.co' });
  });

  it('shows server validation errors next to the fields and omits empty optional fields', async () => {
    const fetchMock = mockApi({
      'POST /leads': () => ({
        status: 400,
        body: {
          error: 'invalid_input',
          message: 'Invalid lead',
          details: [
            { path: 'email', message: 'Invalid email address' },
            { path: 'message', message: 'Too small: expected string to have >=20 characters' },
          ],
        },
      }),
    });
    render(<LeadForm onResult={() => {}} />);

    await userEvent.type(screen.getByLabelText('Name'), 'Bob');
    await userEvent.type(screen.getByLabelText('Email'), 'nope');
    await userEvent.type(screen.getByLabelText('Message'), 'hi');
    await userEvent.click(screen.getByRole('button', { name: 'Qualify lead' }));

    expect(screen.getByText('Invalid email address')).toBeTruthy();
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(/expected string to have >=20/)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/fix the highlighted fields/);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).not.toHaveProperty('company');
  });

  it('locks the form while the agent works', async () => {
    let finish: () => void = () => {};
    mockApi({
      'POST /leads': () =>
        new Promise((resolve) => {
          finish = () => resolve({ status: 201, body: result });
        }),
    });
    render(<LeadForm onResult={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Hot lead' }));
    await userEvent.click(screen.getByRole('button', { name: 'Qualify lead' }));

    const button = await screen.findByRole('button', { name: /Agent is analysing/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    finish();
    expect(await screen.findByRole('button', { name: 'Qualify lead' })).toBeTruthy();
  });
});
