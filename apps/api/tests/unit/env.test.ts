import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

describe('loadEnv', () => {
  it('applies defaults for the mock provider', () => {
    const env = loadEnv({});
    expect(env.LLM_PROVIDER).toBe('mock');
    expect(env.AGENT_MAX_RETRIES).toBe(2);
  });

  it('requires an API key for real providers', () => {
    expect(() => loadEnv({ LLM_PROVIDER: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('accepts a keyless OpenAI-compatible local server such as Ollama', () => {
    const env = loadEnv({
      LLM_PROVIDER: 'openai-compatible',
      OPENAI_BASE_URL: 'http://localhost:11434/v1',
      OPENAI_MODEL: 'qwen3:8b',
    });
    expect(env.OPENAI_BASE_URL).toBe('http://localhost:11434/v1');
  });

  it('requires a model and, for hosted OpenAI, a key', () => {
    expect(() => loadEnv({ LLM_PROVIDER: 'openai-compatible' })).toThrow(/OPENAI_MODEL/);
    expect(() => loadEnv({ LLM_PROVIDER: 'openai-compatible', OPENAI_MODEL: 'gpt' })).toThrow(
      /OPENAI_API_KEY/,
    );
  });
});
