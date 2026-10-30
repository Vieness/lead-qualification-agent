import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { LLMRequest } from '../../../src/llm/index.js';
import { OpenAICompatibleProvider } from '../../../src/llm/openai-compatible.js';
import { fakeFetch, type FakeResponse } from '../../helpers/fake-fetch.js';

const completion = (message: Record<string, unknown>, finishReason = 'stop'): FakeResponse => ({
  body: {
    id: 'cmpl_1',
    object: 'chat.completion',
    created: 0,
    model: 'qwen3:8b',
    choices: [
      { index: 0, message: { role: 'assistant', ...message }, finish_reason: finishReason },
    ],
    usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
  },
});

function provider(...responses: FakeResponse[]) {
  return providerWith({}, ...responses);
}

function providerWith(options: { reasoningEffort?: boolean }, ...responses: FakeResponse[]) {
  const fake = fakeFetch(...(responses.length ? responses : [completion({ content: 'Hi' })]));
  const instance = new OpenAICompatibleProvider({
    model: 'qwen3:8b',
    baseURL: 'http://localhost:11434/v1',
    fetch: fake.fetch,
    ...options,
  });
  return { instance, requests: fake.requests };
}

const baseRequest: LLMRequest = {
  purpose: 'test',
  system: 'You qualify leads.',
  messages: [{ role: 'user', content: 'Lead text' }],
};

describe('OpenAICompatibleProvider', () => {
  it('calls chat completions on the configured base URL', async () => {
    const { instance, requests } = provider();
    await instance.complete({
      ...baseRequest,
      tools: [{ name: 'lookup', description: 'Look up', input: z.object({ domain: z.string() }) }],
    });

    expect(requests[0]?.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(requests[0]?.body).toMatchObject({
      model: 'qwen3:8b',
      temperature: 0,
      messages: [
        { role: 'system', content: 'You qualify leads.' },
        { role: 'user', content: 'Lead text' },
      ],
      tools: [
        {
          type: 'function',
          function: { name: 'lookup', parameters: { type: 'object', required: ['domain'] } },
        },
      ],
    });
  });

  it('sends effort as reasoning_effort only when enabled', async () => {
    const on = providerWith({ reasoningEffort: true });
    const off = provider();
    await on.instance.complete({ ...baseRequest, effort: 'low' });
    await on.instance.complete(baseRequest);
    await off.instance.complete({ ...baseRequest, effort: 'low' });

    expect(on.requests[0]?.body.reasoning_effort).toBe('low');
    expect(on.requests[1]?.body).not.toHaveProperty('reasoning_effort');
    expect(off.requests[0]?.body).not.toHaveProperty('reasoning_effort');
  });

  it('asks for JSON schema output', async () => {
    const { instance, requests } = provider();
    await instance.complete({
      ...baseRequest,
      output: { name: 'lead', schema: z.object({ score: z.number() }) },
    });
    expect(requests[0]?.body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'lead', schema: { type: 'object' } },
    });
  });

  it('maps tool history to assistant tool_calls and tool messages', async () => {
    const { instance, requests } = provider();
    await instance.complete({
      ...baseRequest,
      messages: [
        { role: 'user', content: 'go' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'c1', name: 'lookup', args: { domain: 'a.io' } }],
        },
        { role: 'tool', toolCallId: 'c1', content: '{"found":true}' },
      ],
    });

    expect((requests[0]?.body.messages as unknown[]).slice(2)).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'lookup', arguments: '{"domain":"a.io"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: '{"found":true}' },
    ]);
  });

  it('parses tool call arguments and keeps invalid JSON as a string', async () => {
    const { instance } = provider(
      completion(
        {
          content: null,
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'lookup', arguments: '{"domain":"a.io"}' },
            },
            { id: 'c2', type: 'function', function: { name: 'lookup', arguments: '{oops' } },
          ],
        },
        'tool_calls',
      ),
    );
    const result = await instance.complete(baseRequest);

    expect(result).toMatchObject({
      text: null,
      stopReason: 'tool_use',
      usage: { inputTokens: 20, outputTokens: 5 },
      toolCalls: [
        { id: 'c1', args: { domain: 'a.io' } },
        { id: 'c2', args: '{oops' },
      ],
    });
  });

  it.each([
    ['length', 'max_tokens'],
    ['content_filter', 'refusal'],
  ])('maps finish_reason %s to %s', async (finish, stop) => {
    const { instance } = provider(completion({ content: 'x' }, finish));
    await expect(instance.complete(baseRequest)).resolves.toMatchObject({ stopReason: stop });
  });

  it.each([
    [503, 'server', true],
    [429, 'rate_limit', true],
    [401, 'auth', false],
  ])('maps HTTP %i to %s', async (status, kind, retryable) => {
    const { instance } = provider({ status, body: { error: { message: 'nope' } } });
    await expect(instance.complete(baseRequest)).rejects.toMatchObject({ kind, retryable });
  });
});
