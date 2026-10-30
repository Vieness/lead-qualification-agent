import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { generateStructured, MockProvider, type MockResponder } from '../../../src/llm/index.js';

const Schema = z.object({ name: z.string(), budget: z.number().positive() });

function run(responder: MockResponder, maxRetries = 2) {
  const provider = new MockProvider({ extract: responder });
  const pending = generateStructured(
    provider,
    {
      purpose: 'extract',
      system: 'sys',
      messages: [{ role: 'user', content: 'lead text' }],
      output: { name: 'lead', schema: Schema },
    },
    { maxRetries },
  );
  return { provider, pending };
}

describe('generateStructured', () => {
  it('returns valid output from the first attempt', async () => {
    const { pending } = run({ json: { name: 'Acme', budget: 100 } });
    await expect(pending).resolves.toMatchObject({
      data: { name: 'Acme', budget: 100 },
      retries: 0,
    });
  });

  it('sends validation errors back to the model and accepts the fix', async () => {
    const { provider, pending } = run([
      { json: { name: 'Acme', budget: -5 } },
      { json: { name: 'Acme', budget: 5 } },
    ]);

    await expect(pending).resolves.toMatchObject({ data: { budget: 5 }, retries: 1 });

    const retry = provider.calls[1]?.messages ?? [];
    expect(retry).toHaveLength(3);
    expect(retry[1]).toMatchObject({ role: 'assistant', content: '{"name":"Acme","budget":-5}' });
    expect(retry[2]?.role).toBe('user');
    expect(retry[2]?.content).toMatch(/did not match the required schema[\s\S]*budget/);
  });

  it('recovers from invalid JSON', async () => {
    const { provider, pending } = run([
      { text: 'Sure! {name: Acme' },
      { json: { name: 'A', budget: 1 } },
    ]);
    await expect(pending).resolves.toMatchObject({ retries: 1 });
    expect(provider.calls[1]?.messages.at(-1)?.content).toMatch(/not valid JSON/);
  });

  it('accepts JSON wrapped in a markdown fence', async () => {
    const { pending } = run({ text: '```json\n{"name":"Acme","budget":1}\n```' });
    await expect(pending).resolves.toMatchObject({ data: { name: 'Acme' } });
  });

  it('asks for a shorter answer when output was truncated', async () => {
    const { provider, pending } = run([
      { text: '{"name":"Ac', stopReason: 'max_tokens' },
      { json: { name: 'A', budget: 1 } },
    ]);
    await pending;
    expect(provider.calls[1]?.messages.at(-1)?.content).toMatch(/cut off by the token limit/);
  });

  it('fails with invalid_output after exhausting retries', async () => {
    const { provider, pending } = run({ json: { name: 'Acme' } }, 2);
    await expect(pending).rejects.toMatchObject({ kind: 'invalid_output', retryable: false });
    expect(provider.calls).toHaveLength(3);
  });

  it('does not retry a refusal', async () => {
    const { provider, pending } = run({ text: '', stopReason: 'refusal' });
    await expect(pending).rejects.toMatchObject({ kind: 'refusal' });
    expect(provider.calls).toHaveLength(1);
  });
});
