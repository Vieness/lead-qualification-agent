import { describe, expect, it, vi } from 'vitest';
import {
  LLMError,
  MockProvider,
  ResilientProvider,
  type LLMErrorKind,
  type LLMProvider,
  type LLMRequest,
} from '../../../src/llm/index.js';

const request: LLMRequest = { purpose: 'test', system: 'sys', messages: [] };

function setup(inner: LLMProvider, overrides: { maxRetries?: number; timeoutMs?: number } = {}) {
  const sleep = vi.fn(async (_ms: number) => {});
  const onRetry = vi.fn();
  const provider = new ResilientProvider(inner, {
    timeoutMs: overrides.timeoutMs ?? 1_000,
    maxRetries: overrides.maxRetries ?? 2,
    baseDelayMs: 500,
    sleep,
    onRetry,
    random: () => 0,
  });
  return { provider, sleep, onRetry };
}

/** Never answers; rejects only when its signal is aborted. */
const hangingProvider: LLMProvider = {
  name: 'mock',
  model: 'hang',
  complete: ({ signal }) =>
    new Promise((_, reject) =>
      signal?.addEventListener('abort', () => reject(new Error('aborted'))),
    ),
};

describe('ResilientProvider', () => {
  it('retries a transient error and then succeeds', async () => {
    const inner = new MockProvider({ test: [new LLMError('rate_limit', '429'), { text: 'ok' }] });
    const { provider, onRetry } = setup(inner);

    const result = await provider.complete(request);

    expect(result.text).toBe('ok');
    expect(inner.calls).toHaveLength(2);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ attempt: 1, delayMs: 500 }));
  });

  it.each<LLMErrorKind>(['bad_request', 'auth', 'refusal', 'invalid_output'])(
    'does not retry %s',
    async (kind) => {
      const inner = new MockProvider({ test: new LLMError(kind, kind) });
      const { provider } = setup(inner);

      await expect(provider.complete(request)).rejects.toMatchObject({ kind });
      expect(inner.calls).toHaveLength(1);
    },
  );

  it('gives up after maxRetries and rethrows the last error', async () => {
    const inner = new MockProvider({ test: new LLMError('server', '503') });
    const { provider, sleep } = setup(inner, { maxRetries: 2 });

    await expect(provider.complete(request)).rejects.toMatchObject({ kind: 'server' });
    expect(inner.calls).toHaveLength(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
  });

  it('prefers the provider retry-after over computed backoff', async () => {
    const inner = new MockProvider({
      test: [new LLMError('rate_limit', '429', { retryAfterMs: 3_000 }), { text: 'ok' }],
    });
    const { provider, sleep } = setup(inner);

    await provider.complete(request);
    expect(sleep.mock.calls[0]?.[0]).toBe(3_000);
  });

  it('caps a provider retry-after at maxDelayMs', async () => {
    const inner = new MockProvider({
      test: [new LLMError('rate_limit', '429', { retryAfterMs: 600_000 }), { text: 'ok' }],
    });
    const { provider, sleep } = setup(inner);

    await provider.complete(request);
    expect(sleep.mock.calls[0]?.[0]).toBe(8_000);
  });

  it('stops waiting for a retry as soon as the caller aborts', async () => {
    const controller = new AbortController();
    const provider = new ResilientProvider(
      new MockProvider({ test: new LLMError('rate_limit', '429', { retryAfterMs: 5_000 }) }),
      { timeoutMs: 1_000, maxRetries: 2, baseDelayMs: 500 },
    );
    setTimeout(() => controller.abort(), 10);
    const started = Date.now();

    await expect(
      provider.complete({ ...request, signal: controller.signal }),
    ).rejects.toMatchObject({
      kind: 'aborted',
    });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('grows backoff exponentially with jitter and caps it', () => {
    const provider = new ResilientProvider(new MockProvider(), {
      timeoutMs: 1_000,
      maxRetries: 5,
      baseDelayMs: 500,
      maxDelayMs: 4_000,
      random: () => 1,
    });
    expect([0, 1, 2, 3, 4].map((a) => provider.backoff(a))).toEqual([600, 1200, 2400, 4800, 4800]);
  });

  it('turns a hanging call into a timeout error', async () => {
    const { provider } = setup(hangingProvider, { maxRetries: 0, timeoutMs: 20 });
    await expect(provider.complete(request)).rejects.toMatchObject({
      kind: 'timeout',
      retryable: true,
    });
  });

  it('does not retry when the caller aborts', async () => {
    const controller = new AbortController();
    const { provider, sleep } = setup(hangingProvider);

    const pending = provider.complete({ ...request, signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('rate limits', () => {
  it('gives 429s more retries than other transient errors', async () => {
    const sleep = async () => {};
    const limited = new MockProvider({ test: new LLMError('rate_limit', '429') });
    const broken = new MockProvider({ test: new LLMError('server', '503') });
    const options = {
      timeoutMs: 1_000,
      maxRetries: 2,
      maxRateLimitRetries: 5,
      baseDelayMs: 1,
      sleep,
    };

    await expect(new ResilientProvider(limited, options).complete(request)).rejects.toThrow();
    await expect(new ResilientProvider(broken, options).complete(request)).rejects.toThrow();
    expect(limited.calls).toHaveLength(6);
    expect(broken.calls).toHaveLength(3);
  });

  it('fails at once when the provider asks to wait longer than maxRetryAfterMs', async () => {
    const sleep = vi.fn(async () => {});
    const onRetry = vi.fn();
    const inner = new MockProvider({
      test: new LLMError('rate_limit', '429 tokens per minute', { retryAfterMs: 98_928 }),
    });
    const provider = new ResilientProvider(inner, {
      timeoutMs: 1_000,
      maxRetries: 2,
      maxRateLimitRetries: 5,
      maxRetryAfterMs: 30_000,
      baseDelayMs: 1,
      sleep,
      onRetry,
    });

    await expect(provider.complete(request)).rejects.toMatchObject({
      kind: 'quota_exhausted',
      message: expect.stringMatching(/wait 99s, more than the 30s retry limit/),
    });
    expect(inner.calls).toHaveLength(1);
    expect(onRetry).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry an error already classified as quota_exhausted', async () => {
    const inner = new MockProvider({ test: new LLMError('quota_exhausted', '429 per day') });
    const { provider, onRetry } = setup(inner);

    await expect(provider.complete(request)).rejects.toMatchObject({ kind: 'quota_exhausted' });
    expect(inner.calls).toHaveLength(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('never runs more calls at once than maxConcurrency', async () => {
    let active = 0;
    let peak = 0;
    const slow: LLMProvider = {
      name: 'mock',
      model: 'slow',
      complete: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
        return {
          text: 'ok',
          toolCalls: [],
          stopReason: 'end',
          usage: { inputTokens: 0, outputTokens: 0 },
          model: 'slow',
        };
      },
    };
    const provider = new ResilientProvider(slow, {
      timeoutMs: 1_000,
      maxRetries: 0,
      baseDelayMs: 1,
      maxConcurrency: 2,
    });

    await Promise.all(Array.from({ length: 6 }, () => provider.complete(request)));
    expect(peak).toBe(2);
  });
});
