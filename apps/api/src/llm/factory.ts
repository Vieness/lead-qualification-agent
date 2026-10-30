import type { Env } from '../config/env.js';
import { AnthropicProvider } from './anthropic.js';
import { createDemoMockProvider } from './demo-mock.js';
import type { MockProvider } from './mock.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { ResilientProvider, type RetryInfo } from './resilient.js';
import type { LLMProvider } from './types.js';

export type LLMFactoryOptions = {
  fetch?: typeof fetch;
  onRetry?: (info: RetryInfo) => void;
  /** Provider used when LLM_PROVIDER=mock; tests pass a scripted one, otherwise the keyless demo mock. */
  mock?: MockProvider;
};

/** Picks the adapter from env (Strategy) and wraps it with timeouts and retries (Decorator). */
export function createLLMProvider(env: Env, options: LLMFactoryOptions = {}): LLMProvider {
  return new ResilientProvider(createBaseProvider(env, options), {
    timeoutMs: env.AGENT_LLM_TIMEOUT_MS,
    maxRetries: env.AGENT_MAX_RETRIES,
    maxRateLimitRetries: env.LLM_RATE_LIMIT_RETRIES,
    maxConcurrency: env.LLM_MAX_CONCURRENCY,
    maxRetryAfterMs: env.LLM_MAX_RETRY_AFTER_MS,
    baseDelayMs: env.LLM_RETRY_BASE_MS,
    ...(options.onRetry && { onRetry: options.onRetry }),
  });
}

function createBaseProvider(env: Env, options: LLMFactoryOptions): LLMProvider {
  switch (env.LLM_PROVIDER) {
    case 'anthropic':
      // loadEnv guarantees the key is present for this provider
      return new AnthropicProvider({
        apiKey: env.ANTHROPIC_API_KEY ?? '',
        model: env.ANTHROPIC_MODEL,
        fallbacks: env.ANTHROPIC_FALLBACKS,
        ...(options.fetch && { fetch: options.fetch }),
      });
    case 'openai-compatible':
      return new OpenAICompatibleProvider({
        model: env.OPENAI_MODEL ?? '',
        ...(env.OPENAI_API_KEY && { apiKey: env.OPENAI_API_KEY }),
        ...(env.OPENAI_BASE_URL && { baseURL: env.OPENAI_BASE_URL }),
        reasoningEffort: env.OPENAI_REASONING_EFFORT === 'auto',
        ...(options.fetch && { fetch: options.fetch }),
      });
    case 'mock':
      return options.mock ?? createDemoMockProvider();
  }
}
