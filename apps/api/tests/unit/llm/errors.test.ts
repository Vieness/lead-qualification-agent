import { describe, expect, it } from 'vitest';
import { apiError, describeLlmFailure, retryAfterFromMessage } from '../../../src/llm/index.js';

// The exact wording Groq sent when the free tier's daily token limit ran out (October 2026)
const GROQ_DAILY =
  'LLM API error 429: 429 Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199655, Requested 1530. Please try again in 8m53.52s.';

describe('apiError', () => {
  it('classifies a daily-limit 429 as quota_exhausted, which is not retried', () => {
    const error = apiError(429, GROQ_DAILY, null, undefined);
    expect(error).toMatchObject({
      kind: 'quota_exhausted',
      retryable: false,
      retryAfterMs: 533_520,
    });
  });

  it('keeps a per-minute 429 retryable and prefers the retry-after header', () => {
    const message = 'LLM API error 429: tokens per minute (TPM). Please try again in 2.16s.';
    expect(apiError(429, message, null, undefined)).toMatchObject({
      kind: 'rate_limit',
      retryable: true,
      retryAfterMs: 2_160,
    });
    expect(apiError(429, message, '3', undefined).retryAfterMs).toBe(3_000);
  });

  it('treats a billing quota as exhausted too', () => {
    expect(apiError(429, 'You exceeded your current quota', null, undefined).kind).toBe(
      'quota_exhausted',
    );
  });

  it('leaves other statuses alone even when they mention a quota', () => {
    expect(apiError(500, 'quota service down', null, undefined).kind).toBe('server');
  });
});

describe('retryAfterFromMessage', () => {
  it.each([
    ['Please try again in 2.16s.', 2_160],
    ['try again in 1m38.928s', 98_928],
    ['Try again in 1h2m3s', 3_723_000],
  ])('reads "%s"', (message, ms) => {
    expect(retryAfterFromMessage(message)).toBe(ms);
  });

  it('returns undefined without a hint', () => {
    expect(retryAfterFromMessage('Rate limit reached')).toBeUndefined();
  });
});

describe('describeLlmFailure', () => {
  it('turns a provider message into one plain line with the wait', () => {
    const text = describeLlmFailure('quota_exhausted', GROQ_DAILY);
    expect(text).toBe("the model provider's token quota is used up; try again in about 9 min");
    expect(text).not.toMatch(/org_|Upgrade|200000/);
  });

  it('gives seconds for short waits and no wait when none is known', () => {
    expect(describeLlmFailure('rate_limit', 'Please try again in 2.16s.')).toBe(
      'the model provider is rate limiting requests; try again in about 3 s',
    );
    expect(describeLlmFailure('timeout', 'LLM call timed out after 30000ms')).toBe(
      'the model did not answer in time',
    );
  });

  it('leaves our own failures to their message', () => {
    expect(describeLlmFailure('invalid_output', 'No valid "requirements"')).toBeNull();
    expect(describeLlmFailure('tool_error', 'boom')).toBeNull();
  });
});
