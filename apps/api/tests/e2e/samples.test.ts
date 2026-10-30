import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { compare } from '../../src/eval/compare.js';
import { loadDataset } from '../../src/eval/dataset.js';
import { createLogger } from '../../src/observability/index.js';
import { qualifyLead } from '../../src/qualify.js';
import { createServices, type Services } from '../../src/services.js';

// Regression suite: every lead in data/samples runs through the whole pipeline (demo mock +
// in-memory Postgres) and must meet its business expectation in data/expected.

const cases = await loadDataset();
let services: Services;

beforeAll(async () => {
  services = await createServices(loadEnv({ LLM_PROVIDER: 'mock', LOG_LEVEL: 'silent' }), {
    memory: true,
    logger: createLogger({ level: 'silent' }),
  });
});
afterAll(() => services.close());

describe('data/samples', () => {
  it('covers business scenarios and attacks, each with an expectation', () => {
    expect(cases.filter((c) => !c.attack).length).toBeGreaterThanOrEqual(12);
    expect(cases.filter((c) => c.attack).length).toBeGreaterThanOrEqual(8);
  });

  it.each(cases.map((c) => [c.id, c] as const))('%s meets its expectation', async (_id, c) => {
    const run = await qualifyLead(c.lead, services);
    const llmCalls = run.events.filter((e) => e.type === 'llm_call').length;
    expect(compare({ result: run.result, llmCalls }, c.expected)).toEqual([]);
  });
});
