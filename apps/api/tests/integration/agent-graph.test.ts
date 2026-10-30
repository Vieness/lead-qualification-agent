import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildGraph,
  runLeadAgent,
  type AgentConfig,
  type AgentDeps,
} from '../../src/agents/index.js';
import { loadEnv } from '../../src/config/env.js';
import { AgentStateSchema, LeadInputSchema, type LeadInputRaw } from '../../src/contracts/index.js';
import { DEFAULT_PORTFOLIO_DIR } from '../../src/db/paths.js';
import { loadPortfolio } from '../../src/db/portfolio-loader.js';
import { createDemoMockProvider } from '../../src/llm/demo-mock.js';
import { LLM_PURPOSES, LLMError } from '../../src/llm/index.js';
import { agentConfigFromEnv } from '../../src/services.js';
import { JsonCompanyDirectory, type ToolContext } from '../../src/tools/index.js';
import { createToolContext } from '../helpers/tool-context.js';

// The same defaults the API runs with
const DEFAULT_AGENT_CONFIG = agentConfigFromEnv(loadEnv({ LLM_PROVIDER: 'mock' }));
const ATTACKS = fileURLToPath(new URL('../../../../data/samples/attacks/', import.meta.url));

let base: ToolContext;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ ctx: base, close } = await createToolContext({ companies: new JsonCompanyDirectory() }));
  await base.portfolio.upsertMany(await loadPortfolio(DEFAULT_PORTFOLIO_DIR));
});
afterAll(() => close());

/** Fresh demo mock per run so call counts and scripts never leak between tests. */
function setup(config: Partial<AgentConfig> = {}) {
  const llm = createDemoMockProvider();
  const deps: AgentDeps = {
    tools: { ...base, llm },
    config: { ...DEFAULT_AGENT_CONFIG, ...config },
  };
  const run = (lead: LeadInputRaw) => runLeadAgent(LeadInputSchema.parse(lead), deps);
  return { llm, run };
}

const hotLead: LeadInputRaw = {
  name: 'Olena',
  email: 'olena@brewlane.co',
  company: 'Brewlane Coffee',
  message: 'We need a loyalty mobile app for our coffee chain, budget $40k, launch in 3 months.',
};

const cleanDraft = {
  language: 'en',
  subject: 'Your loyalty app',
  body: 'Hi Olena, thanks for reaching out. Could we schedule a short call?',
};
const pricedDraft = { ...cleanDraft, body: 'Hi Olena, an app like this costs about $35k.' };
const codes = (findings: Array<{ code: string }>) => findings.map((f) => f.code);

// Scenario coverage per sample lives in tests/e2e/samples.test.ts; these tests pin graph mechanics.
describe('lead agent graph (demo mock + PGlite)', () => {
  it('qualifies a hot lead end to end and drafts an automatic reply', async () => {
    const { result, state } = await setup().run(hotLead);

    expect(result).toMatchObject({ decision: 'auto_reply', status: 'completed', tier: 'hot' });
    expect(result.matchedCases[0]?.id).toBe('loyalty-app-coffee-chain');
    expect(result.summary).toMatch(/^Hot lead \(\d+\/100\): mobile app, budget ≈ \$40k/);
    expect(state.toolCalls.map((c) => c.tool)).toEqual([
      'extract_requirements',
      'enrich_company',
      'search_portfolio',
      'search_portfolio',
      'score_lead',
      'draft_reply',
      'save_to_crm',
    ]);
    expect(state.toolCalls.map((c) => c.step)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(state.routeLog.map((r) => r.next)).toEqual([
      'research',
      'matching',
      'writer',
      'policy_guard',
      'finalize',
    ]);
    expect(Object.keys(result.promptVersions).sort()).toEqual([
      'draft-reply',
      'extract-requirements',
      'match-portfolio',
    ]);
    expect(() => AgentStateSchema.parse(state)).not.toThrow();
    expect((await base.leads.findById(result.leadId))?.result).toEqual(result);
  });

  it('catches injection hidden in enrichment data and keeps it away from the writer', async () => {
    const attack = JSON.parse(await readFile(`${ATTACKS}enrichment-injection.json`, 'utf8'));
    const { llm, run } = setup();
    const { result } = await run(attack);

    expect(result).toMatchObject({ decision: 'human_review', company: { description: null } });
    expect(result.guardrails.findings.find((f) => f.code === 'prompt_injection')?.message).toMatch(
      /Enrichment data for growthhackz\.biz/,
    );
    const promptsSeen = llm.calls.flatMap((c) => c.messages.map((m) => m.content)).join('\n');
    expect(promptsSeen).not.toMatch(/ignore all previous instructions/i);
  });
});

describe('policy rewrite loop', () => {
  it('rewrites a draft that names a price and then replies automatically', async () => {
    const { llm, run } = setup();
    llm.on(LLM_PURPOSES.draftReply, [{ json: pricedDraft }, { json: cleanDraft }]);

    const { result, state } = await run(hotLead);

    expect(result.decision).toBe('auto_reply');
    expect(state.rewrites).toBe(1);
    expect(codes(result.guardrails.findings)).not.toContain('price_promise');
    const rewriteRequest = llm.callsFor(LLM_PURPOSES.draftReply)[1]?.messages[0]?.content;
    expect(rewriteRequest).toMatch(/"policyFeedback"[\s\S]*mentions a price/);
  });

  it('gives up after one rewrite and asks a human', async () => {
    const { llm, run } = setup();
    llm.on(LLM_PURPOSES.draftReply, { json: pricedDraft });

    const { result, state } = await run(hotLead);

    expect(result).toMatchObject({ decision: 'human_review', draftReply: pricedDraft });
    expect(codes(result.guardrails.findings)).toContain('price_promise');
    expect(llm.callsFor(LLM_PURPOSES.draftReply)).toHaveLength(2);
    expect(state.routeLog.at(-1)?.reason).toBe('policy violations remain after rewrite');
  });
});

describe('failure handling', () => {
  it('hands the lead to a human when requirements cannot be extracted', async () => {
    const { llm, run } = setup();
    llm.on(LLM_PURPOSES.extractRequirements, new LLMError('server', 'model overloaded'));

    const { result } = await run(hotLead);

    expect(result).toMatchObject({
      decision: 'human_review',
      status: 'pending_approval',
      draftReply: null,
      requirements: null,
      summary: expect.stringMatching(/^Lead not analysed.*llm_unavailable/),
    });
  });

  it('falls back to keyword search when the matching model is down', async () => {
    const { llm, run } = setup();
    llm.on(LLM_PURPOSES.matchPortfolio, new LLMError('server', 'down'));

    const { result, state } = await run(hotLead);

    expect(result.decision).toBe('auto_reply');
    expect(result.matchedCases.length).toBeGreaterThan(0);
    expect(state.errors.join()).toMatch(
      /Search planning failed \(the model provider returned an error\); used keyword search/,
    );
  });

  it('returns invalid tool arguments to the model, which then corrects itself', async () => {
    const { llm, run } = setup();
    llm.on(LLM_PURPOSES.matchPortfolio, [
      {
        toolCalls: [
          { id: 'c1', name: 'search_portfolio', args: { query: '', services: [], limit: 3 } },
        ],
      },
      {
        toolCalls: [
          {
            id: 'c2',
            name: 'search_portfolio',
            args: { query: 'loyalty app', services: [], limit: 3 },
          },
        ],
      },
      { text: 'Done.' },
    ]);

    const { state } = await run(hotLead);

    const searches = state.toolCalls.filter((c) => c.tool === 'search_portfolio');
    // two model searches (the first rejected), then the code-built scoring search
    expect(searches.map((c) => c.error === null)).toEqual([false, true, true]);
    const feedback = llm.callsFor(LLM_PURPOSES.matchPortfolio)[1]?.messages.at(-1);
    expect(feedback).toMatchObject({
      role: 'tool',
      isError: true,
      content: expect.stringMatching(/Invalid arguments/),
    });
  });

  it('caps the number of searches the model can make', async () => {
    const { llm, run } = setup({ maxSearchTurns: 3 });
    llm.on(LLM_PURPOSES.matchPortfolio, () => ({
      toolCalls: [
        {
          id: crypto.randomUUID(),
          name: 'search_portfolio',
          args: { query: 'app', services: [], limit: 3 },
        },
      ],
    }));

    const { state } = await run(hotLead);

    // three model searches plus the code-built scoring search
    expect(state.toolCalls.filter((c) => c.tool === 'search_portfolio')).toHaveLength(4);
    expect(llm.callsFor(LLM_PURPOSES.matchPortfolio)).toHaveLength(4);
  });

  it('does not let the model raise the score with broad searches', async () => {
    const quiet = setup();
    quiet.llm.on(LLM_PURPOSES.matchPortfolio, { text: 'No search needed.' });
    const greedy = setup();
    greedy.llm.on(LLM_PURPOSES.matchPortfolio, [
      {
        toolCalls: [
          {
            id: 'broad',
            name: 'search_portfolio',
            args: {
              query: 'app web design mobile marketing branding automation',
              services: [],
              limit: 5,
            },
          },
        ],
      },
      { text: 'Done.' },
    ]);

    const baseline = (await quiet.run(hotLead)).result;
    const manipulated = (await greedy.run(hotLead)).result;

    expect(manipulated.score).toBe(baseline.score);
    expect(manipulated.scoreBreakdown).toEqual(baseline.scoreBreakdown);
  });

  it('finalizes for human review when the time budget runs out', async () => {
    const { result, state } = await setup({ runBudgetMs: 1 }).run(hotLead);
    expect(result).toMatchObject({ decision: 'human_review', status: 'pending_approval' });
    expect(codes(result.guardrails.findings)).toContain('time_budget_exceeded');
    expect(state.routeLog.at(-1)?.reason).toBe('time budget exhausted');
  });

  it('still saves the lead for review when the caller cancels', async () => {
    const llm = createDemoMockProvider();
    const deps: AgentDeps = { tools: { ...base, llm }, config: DEFAULT_AGENT_CONFIG };
    const { result } = await runLeadAgent(LeadInputSchema.parse(hotLead), deps, {
      signal: AbortSignal.abort(),
    });

    expect(result).toMatchObject({ decision: 'human_review', status: 'pending_approval' });
    expect(codes(result.guardrails.findings)).toContain('llm_unavailable');
    expect(await base.leads.findById(result.leadId)).not.toBeNull();
  });

  it('compiles the graph once per set of dependencies', () => {
    const deps: AgentDeps = { tools: base, config: DEFAULT_AGENT_CONFIG };
    expect(buildGraph(deps)).toBe(buildGraph(deps));
    expect(buildGraph({ ...deps })).not.toBe(buildGraph(deps));
  });

  it('stops at the step limit and asks a human', async () => {
    const { result } = await setup({ maxSteps: 2 }).run(hotLead);
    expect(result.decision).toBe('human_review');
    expect(codes(result.guardrails.findings)).toContain('step_limit_reached');
  });
});
