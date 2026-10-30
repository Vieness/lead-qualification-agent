import { describe, expect, it } from 'vitest';
import { LLMError, MockProvider, ResilientProvider } from '../../../src/llm/index.js';
import {
  currentRun,
  ObservedProvider,
  recordRetry,
  shapeOf,
  withRunContext,
  type RunContext,
} from '../../../src/observability/index.js';
import { memoryLogger } from '../../helpers/memory-logger.js';

const request = { purpose: 'extract_requirements', system: 'sys', messages: [] };

function context(traceId: string) {
  const log = memoryLogger();
  const ctx: RunContext = {
    traceId,
    logger: log.logger.child({ traceId }),
    events: [],
    startedAt: Date.now(),
  };
  return { ctx, log };
}

describe('ObservedProvider', () => {
  it('records each call with tokens, latency and stop reason', async () => {
    const { ctx, log } = context('t-1');
    const provider = new ObservedProvider(
      new MockProvider({ extract_requirements: { text: '{"a":1}' } }),
    );

    await withRunContext(ctx, () => provider.complete(request));

    expect(ctx.events).toMatchObject([
      {
        type: 'llm_call',
        purpose: 'extract_requirements',
        model: 'mock',
        stopReason: 'end',
        error: null,
      },
    ]);
    expect(ctx.events[0]).toMatchObject({ inputTokens: 1, outputTokens: 2 });
    expect(log.lines()).toMatchObject([{ event: 'llm.call', traceId: 't-1', level: 30 }]);
  });

  it('records failures with the error kind and rethrows', async () => {
    const { ctx, log } = context('t-2');
    const provider = new ObservedProvider(
      new MockProvider({ extract_requirements: new LLMError('auth', 'bad key for olena@acme.io') }),
    );

    await expect(withRunContext(ctx, () => provider.complete(request))).rejects.toMatchObject({
      kind: 'auth',
    });
    expect(ctx.events[0]).toMatchObject({
      error: 'auth: bad key for [email]@acme.io',
      inputTokens: 0,
    });
    expect(log.lines()[0]).toMatchObject({ event: 'llm.call', level: 40 });
  });

  it('is silent outside a run', async () => {
    const provider = new ObservedProvider(
      new MockProvider({ extract_requirements: { text: 'x' } }),
    );
    expect(currentRun()).toBeUndefined();
    await expect(provider.complete(request)).resolves.toMatchObject({ text: 'x' });
  });
});

describe('retries in the run context', () => {
  function flakyProvider() {
    const resilient = new ResilientProvider(
      new MockProvider({
        extract_requirements: [new LLMError('rate_limit', '429'), { text: 'ok' }],
      }),
      {
        timeoutMs: 1_000,
        maxRetries: 2,
        baseDelayMs: 1,
        onRetry: recordRetry,
        sleep: async () => {},
      },
    );
    return new ObservedProvider(resilient);
  }

  it('attributes a retry inside a shared provider to the right run', async () => {
    const a = context('run-a');
    const b = context('run-b');
    const providerA = flakyProvider();
    const providerB = new ObservedProvider(
      new MockProvider({ extract_requirements: { text: 'ok' } }),
    );

    await Promise.all([
      withRunContext(a.ctx, () => providerA.complete(request)),
      withRunContext(b.ctx, () => providerB.complete(request)),
    ]);

    expect(a.ctx.events.map((e) => e.type)).toEqual(['llm_retry', 'llm_call']);
    expect(a.ctx.events[0]).toMatchObject({ attempt: 1, errorKind: 'rate_limit' });
    expect(b.ctx.events.map((e) => e.type)).toEqual(['llm_call']);
    expect(a.log.lines().map((l) => l.traceId)).toEqual(['run-a', 'run-a']);
  });
});

describe('shapeOf', () => {
  it('keeps structure, numbers and booleans but no text', () => {
    expect(
      shapeOf({
        name: 'Olena',
        budget: { max: 40000, raw: '$40k' },
        tags: ['a', 'bb'],
        ok: true,
        none: null,
      }),
    ).toEqual({
      name: '<5 chars>',
      budget: { max: 40000, raw: '<4 chars>' },
      tags: ['<1 chars>', '<2 chars>'],
      ok: true,
      none: null,
    });
  });
});
