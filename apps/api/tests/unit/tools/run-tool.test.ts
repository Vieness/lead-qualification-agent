import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LLMError } from '../../../src/llm/index.js';
import {
  toolRegistry,
  defineTool,
  runTool,
  scoreLeadTool,
  toToolSpec,
  type ToolContext,
} from '../../../src/tools/index.js';
import { company, requirements } from '../../fixtures/contracts.js';
import { createToolContext } from '../../helpers/tool-context.js';

let ctx: ToolContext;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ ctx, close } = await createToolContext());
});
afterAll(() => close());

describe('runTool', () => {
  it('validates arguments, runs the tool and records timing', async () => {
    const run = await runTool(scoreLeadTool, { requirements, company, matchedCasesCount: 1 }, ctx);

    expect(run.ok).toBe(true);
    expect(run.tool).toBe('score_lead');
    expect(run.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(run.startedAt)).not.toBeNaN();
    if (run.ok) expect(run.result.score).toBe(95);
  });

  it('returns invalid_args instead of throwing for bad LLM arguments', async () => {
    const run = await runTool(scoreLeadTool, { requirements, matchedCasesCount: 'two' }, ctx);

    expect(run).toMatchObject({ ok: false, errorKind: 'invalid_args' });
    if (!run.ok) expect(run.error).toMatch(/Invalid arguments for score_lead[\s\S]*company/);
  });

  it('rejects tool output that breaks the contract', async () => {
    const broken = defineTool({
      name: 'score_lead',
      description: 'broken',
      input: z.object({}),
      output: z.object({ score: z.number().max(100) }),
      execute: async () => ({ data: { score: 500 } }),
    });
    await expect(runTool(broken, {}, ctx)).resolves.toMatchObject({
      ok: false,
      errorKind: 'invalid_output',
    });
  });

  it('keeps the LLM error kind when a tool fails', async () => {
    const failing = defineTool({
      name: 'draft_reply',
      description: 'fails',
      input: z.object({}),
      output: z.object({}),
      execute: async () => {
        throw new LLMError('refusal', 'declined');
      },
    });
    await expect(runTool(failing, {}, ctx)).resolves.toMatchObject({
      ok: false,
      errorKind: 'refusal',
      error: 'declined',
    });
  });
});

describe('toolRegistry', () => {
  it('registers the agent tools; save_to_crm stays outside the registry', () => {
    const specs = Object.values(toolRegistry).map(toToolSpec);
    expect(specs.map((s) => s.name)).toEqual([
      'extract_requirements',
      'enrich_company',
      'search_portfolio',
      'score_lead',
      'draft_reply',
    ]);
    expect(specs.every((s) => s.description.length > 20)).toBe(true);
  });
});
