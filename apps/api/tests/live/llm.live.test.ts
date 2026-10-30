import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadEnv } from '../../src/config/env.js';
import { createLLMProvider, generateStructured } from '../../src/llm/index.js';

// Opt-in smoke test against the provider configured in .env: `pnpm --filter @lead-agent/api test:live`.
// Costs a few cents per run and is never part of `make check` or CI.

const env = loadEnv();

describe.skipIf(env.LLM_PROVIDER === 'mock')(`live ${env.LLM_PROVIDER} provider`, () => {
  const provider = createLLMProvider(env);

  it('returns schema-valid structured output', async () => {
    const result = await generateStructured(
      provider,
      {
        purpose: 'live.smoke',
        system: 'Extract the requested fields. Answer with JSON only.',
        messages: [
          {
            role: 'user',
            content: 'Hi, I am Olena from Acme. Budget around $30k for a mobile app.',
          },
        ],
        output: {
          name: 'smoke',
          schema: z.object({ name: z.string(), company: z.string(), budgetUsd: z.number() }),
        },
        effort: 'low',
        maxTokens: 2_000,
      },
      { maxRetries: env.AGENT_MAX_RETRIES },
    );

    expect(result.data).toMatchObject({ name: 'Olena', company: 'Acme', budgetUsd: 30000 });
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });

  it('calls a tool when asked to', async () => {
    const result = await provider.complete({
      purpose: 'live.tool',
      system: 'Use the lookup_company tool to answer.',
      messages: [{ role: 'user', content: 'Look up the company with domain acme.io.' }],
      tools: [
        {
          name: 'lookup_company',
          description: 'Look up a company profile by its website domain.',
          input: z.object({ domain: z.string() }),
        },
      ],
      effort: 'low',
      maxTokens: 2_000,
    });

    expect(result.stopReason).toBe('tool_use');
    expect(result.toolCalls[0]).toMatchObject({
      name: 'lookup_company',
      args: { domain: 'acme.io' },
    });
  });
});
