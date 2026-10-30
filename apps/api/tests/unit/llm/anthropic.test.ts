import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AnthropicProvider } from '../../../src/llm/anthropic.js';
import type { LLMRequest } from '../../../src/llm/index.js';
import { fakeFetch, type FakeResponse } from '../../helpers/fake-fetch.js';

const message = (overrides: Record<string, unknown> = {}): FakeResponse => ({
  body: {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text: 'Hello' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 12, output_tokens: 3 },
    ...overrides,
  },
});

const apiError = (status: number, headers: Record<string, string> = {}): FakeResponse => ({
  status,
  headers,
  body: { type: 'error', error: { type: 'api_error', message: `status ${status}` } },
});

function provider(fallbacks = true, ...responses: FakeResponse[]) {
  const fake = fakeFetch(...(responses.length ? responses : [message()]));
  const instance = new AnthropicProvider({
    apiKey: 'test-key',
    model: 'claude-opus-5-5',
    fallbacks,
    fetch: fake.fetch,
  });
  return { instance, requests: fake.requests };
}

const baseRequest: LLMRequest = {
  purpose: 'test',
  system: 'You qualify leads.',
  messages: [{ role: 'user', content: 'Lead text' }],
};

describe('AnthropicProvider request', () => {
  it('uses strict auto tools, effort and no sampling or forced tool choice', async () => {
    const { instance, requests } = provider();
    await instance.complete({
      ...baseRequest,
      effort: 'low',
      tools: [
        {
          name: 'enrich_company',
          description: 'Look up a company',
          input: z.object({ domain: z.string() }),
        },
      ],
    });

    const body = requests[0]?.body ?? {};
    expect(body).toMatchObject({
      model: 'claude-opus-5-5',
      system: 'You qualify leads.',
      output_config: { effort: 'low' },
      tools: [
        {
          name: 'enrich_company',
          strict: true,
          input_schema: { type: 'object', additionalProperties: false, required: ['domain'] },
        },
      ],
    });
    expect(body).not.toHaveProperty('tool_choice');
    expect(body).not.toHaveProperty('temperature');
  });

  it('requests native structured output for an output schema', async () => {
    const { instance, requests } = provider();
    await instance.complete({
      ...baseRequest,
      output: { name: 'lead', schema: z.object({ score: z.number() }) },
    });
    expect(requests[0]?.body.output_config).toMatchObject({
      effort: 'medium',
      format: { type: 'json_schema', schema: { type: 'object' } },
    });
  });

  it('enables server-side refusal fallback only when configured', async () => {
    const on = provider(true);
    await on.instance.complete(baseRequest);
    expect(on.requests[0]?.body.fallbacks).toBe('default');
    expect(on.requests[0]?.headers.get('anthropic-beta')).toContain(
      'server-side-fallback-2026-07-01',
    );

    const off = provider(false);
    await off.instance.complete(baseRequest);
    expect(off.requests[0]?.body).not.toHaveProperty('fallbacks');
    expect(off.requests[0]?.headers.get('anthropic-beta')).toBeNull();
  });

  it('merges parallel tool results into one user message and replays raw assistant content', async () => {
    const { instance, requests } = provider();
    const raw = [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'tool_use', id: 't1', name: 'a', input: {} },
      { type: 'tool_use', id: 't2', name: 'b', input: {} },
    ];
    await instance.complete({
      ...baseRequest,
      messages: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: '', raw },
        { role: 'tool', toolCallId: 't1', content: '{"ok":true}' },
        { role: 'tool', toolCallId: 't2', content: 'failed', isError: true },
      ],
    });

    const messages = requests[0]?.body.messages as unknown[];
    expect(messages).toHaveLength(3);
    expect(messages[1]).toEqual({ role: 'assistant', content: raw });
    expect(messages[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: '{"ok":true}' },
        { type: 'tool_result', tool_use_id: 't2', content: 'failed', is_error: true },
      ],
    });
  });
});

describe('AnthropicProvider response', () => {
  it('maps text, tool calls, usage and the serving model', async () => {
    const { instance } = provider(
      true,
      message({
        content: [
          { type: 'text', text: 'Checking.' },
          { type: 'tool_use', id: 'tu_1', name: 'enrich_company', input: { domain: 'acme.io' } },
        ],
        stop_reason: 'tool_use',
      }),
    );
    const result = await instance.complete(baseRequest);

    expect(result).toMatchObject({
      text: 'Checking.',
      toolCalls: [{ id: 'tu_1', name: 'enrich_company', args: { domain: 'acme.io' } }],
      stopReason: 'tool_use',
      usage: { inputTokens: 12, outputTokens: 3 },
      model: 'claude-opus-5-5',
    });
  });

  it('reports a refusal as a stop reason', async () => {
    const { instance } = provider(true, message({ content: [], stop_reason: 'refusal' }));
    await expect(instance.complete(baseRequest)).resolves.toMatchObject({
      stopReason: 'refusal',
      text: null,
    });
  });

  it.each([
    [429, 'rate_limit', true],
    [529, 'server', true],
    [500, 'server', true],
    [401, 'auth', false],
    [400, 'bad_request', false],
  ])('maps HTTP %i to %s', async (status, kind, retryable) => {
    const { instance } = provider(true, apiError(status));
    await expect(instance.complete(baseRequest)).rejects.toMatchObject({ kind, retryable });
  });

  it('carries retry-after from a 429', async () => {
    const { instance } = provider(true, apiError(429, { 'retry-after': '2' }));
    await expect(instance.complete(baseRequest)).rejects.toMatchObject({ retryAfterMs: 2000 });
  });
});
