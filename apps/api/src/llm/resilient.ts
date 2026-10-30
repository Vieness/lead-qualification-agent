import { LLMError } from './errors.js';
import { Semaphore } from './limiter.js';
import type { LLMProvider, LLMRequest, LLMResult } from './types.js';
import { errorMessage } from '../error-message.js';

export type RetryInfo = {
  purpose: string;
  attempt: number;
  delayMs: number;
  error: LLMError;
};

export type ResilienceOptions = {
  timeoutMs: number;
  maxRetries: number;
  /** Retries for 429 specifically: waiting it out usually works, so it gets more attempts. */
  maxRateLimitRetries?: number;
  /** LLM calls allowed in flight at once across the process (no limit when omitted). */
  maxConcurrency?: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  /** A 429 asking to wait longer than this is a spent quota, not a blip: fail at once. */
  maxRetryAfterMs?: number;
  /** Called before each retry; stage 8 records these in the trace. */
  onRetry?: (info: RetryInfo) => void;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
};

/** Waits `ms`, or rejects as soon as the caller aborts so a backoff never outlives its request. */
const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new LLMError('aborted', 'Request aborted'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new LLMError('aborted', 'Request aborted'));
      },
      { once: true },
    );
  });

/**
 * Decorator that adds a per-attempt timeout and retries with exponential backoff + jitter.
 * Only transient failures (timeout, 429, 5xx, network) are retried; a provider's own
 * `retry-after` wins over the computed delay.
 */
export class ResilientProvider implements LLMProvider {
  private readonly maxDelayMs: number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly maxRateLimitRetries: number;
  private readonly limiter: Semaphore | null;
  private readonly maxRetryAfterMs: number;

  constructor(
    private readonly inner: LLMProvider,
    private readonly options: ResilienceOptions,
  ) {
    this.maxDelayMs = options.maxDelayMs ?? 8_000;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? options.maxRetries;
    this.limiter = options.maxConcurrency ? new Semaphore(options.maxConcurrency) : null;
    this.maxRetryAfterMs = options.maxRetryAfterMs ?? Infinity;
  }

  get name() {
    return this.inner.name;
  }

  get model() {
    return this.inner.model;
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.attempt(request);
      } catch (err) {
        const error = this.quotaCheck(toLLMError(err));
        const allowed =
          error.kind === 'rate_limit' ? this.maxRateLimitRetries : this.options.maxRetries;
        if (!error.retryable || attempt >= allowed) throw error;

        // A provider asking for minutes of patience still gets at most maxDelayMs
        const delayMs = Math.min(error.retryAfterMs ?? this.backoff(attempt), this.maxDelayMs);
        this.options.onRetry?.({ purpose: request.purpose, attempt: attempt + 1, delayMs, error });
        await this.sleep(delayMs, request.signal);
      }
    }
  }

  /** Turns a 429 whose wait would outlast any retry budget into a non-retryable error. */
  private quotaCheck(error: LLMError): LLMError {
    const wait = error.retryAfterMs;
    if (error.kind !== 'rate_limit' || wait === undefined || wait <= this.maxRetryAfterMs) {
      return error;
    }
    const seconds = (ms: number) => `${Math.round(ms / 1000)}s`;
    return new LLMError(
      'quota_exhausted',
      `${error.message} (provider asks to wait ${seconds(wait)}, more than the ${seconds(this.maxRetryAfterMs)} retry limit)`,
      { cause: error, retryAfterMs: wait },
    );
  }

  /** delay = min(max, base · 2^attempt), plus up to 20% jitter so parallel runs don't sync up. */
  backoff(attempt: number): number {
    const exponential = Math.min(this.maxDelayMs, this.options.baseDelayMs * 2 ** attempt);
    return Math.round(exponential * (1 + 0.2 * this.random()));
  }

  /** Waiting for a free slot does not count against the per-attempt timeout. */
  private attempt(request: LLMRequest): Promise<LLMResult> {
    return this.limiter
      ? this.limiter.run(() => this.timedAttempt(request))
      : this.timedAttempt(request);
  }

  private async timedAttempt(request: LLMRequest): Promise<LLMResult> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.options.timeoutMs);
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeout.signal])
      : timeout.signal;

    try {
      return await this.inner.complete({ ...request, signal });
    } catch (err) {
      if (request.signal?.aborted) throw new LLMError('aborted', 'Request aborted', { cause: err });
      if (timeout.signal.aborted) {
        throw new LLMError('timeout', `LLM call timed out after ${this.options.timeoutMs}ms`, {
          cause: err,
        });
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

function toLLMError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  return new LLMError('server', errorMessage(err), { cause: err });
}
