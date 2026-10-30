import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../../src/config/env.js';
import {
  createLLMProvider,
  LLMError,
  MockProvider,
  ResilientProvider,
} from '../../../src/llm/index.js';

describe('createLLMProvider', () => {
  it.each([
    [{ LLM_PROVIDER: 'mock' }, 'mock', 'mock'],
    [{ LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }, 'anthropic', 'claude-opus-5-5'],
    [
      {
        LLM_PROVIDER: 'openai-compatible',
        OPENAI_BASE_URL: 'http://localhost:11434/v1',
        OPENAI_MODEL: 'qwen3:8b',
      },
      'openai-compatible',
      'qwen3:8b',
    ],
  ])('builds a resilient %o provider', (vars, name, model) => {
    const provider = createLLMProvider(loadEnv(vars));
    expect(provider).toBeInstanceOf(ResilientProvider);
    expect(provider.name).toBe(name);
    expect(provider.model).toBe(model);
  });

  it('applies env retry settings around an injected mock', async () => {
    const mock = new MockProvider({ x: [new LLMError('server', '503'), { text: 'ok' }] });
    const provider = createLLMProvider(loadEnv({ LLM_RETRY_BASE_MS: '1' }), { mock });

    await expect(
      provider.complete({ purpose: 'x', system: '', messages: [] }),
    ).resolves.toMatchObject({
      text: 'ok',
    });
    expect(mock.calls).toHaveLength(2);
  });
});

describe('MockProvider', () => {
  it('replays a queue, repeats the last reply and records calls', async () => {
    const mock = new MockProvider().on('p', [{ text: 'one' }, { json: { n: 2 } }]);
    const ask = () => mock.complete({ purpose: 'p', system: '', messages: [] });

    expect((await ask()).text).toBe('one');
    expect((await ask()).text).toBe('{"n":2}');
    expect((await ask()).text).toBe('{"n":2}');
    expect(mock.callsFor('p')).toHaveLength(3);
  });

  it('fails loudly for an unscripted purpose', async () => {
    await expect(
      new MockProvider().complete({ purpose: 'unknown', system: '', messages: [] }),
    ).rejects.toThrow(/no reply for purpose "unknown"/);
  });
});
