import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { CompanyProfile, MatchedCase, Requirements } from '../contracts/index.js';
import { errorMessage } from '../error-message.js';
import { describeLlmFailure, LLM_PURPOSES, LLMError, type LLMMessage } from '../llm/index.js';
import { dataBlock } from '../prompts/data-block.js';
import {
  scoreLeadTool,
  searchPortfolioTool,
  toToolSpec,
  type ToolContext,
} from '../tools/index.js';
import { NodeTrace, toolsFor, type AgentConfig, type AgentDeps } from './context.js';
import type { GraphState, GraphUpdate } from './state.js';

const TOP_CASES = 3;

/** Adds cases to `found`, keeping the higher relevance when a case turns up twice. */
function keepBest(found: Map<string, MatchedCase>, cases: MatchedCase[]): void {
  for (const c of cases) {
    const previous = found.get(c.id);
    if (!previous || previous.relevance < c.relevance) found.set(c.id, c);
  }
}

type SearchPlan = {
  trace: NodeTrace;
  ctx: ToolContext;
  config: AgentConfig;
  requirements: Requirements;
  company: CompanyProfile;
  /** Collects every case found, best relevance per case. */
  found: Map<string, MatchedCase>;
};

/** Keyword query built by code: the fallback when the model cannot plan searches. */
export function fallbackQuery(requirements: Requirements, company: CompanyProfile): string {
  return [
    requirements.projectType.replace(/_/g, ' '),
    ...requirements.services.map((s) => s.replace(/_/g, ' ')),
    company.industry ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * The model's tool-use loop: it writes English keyword queries (also for non-English leads),
 * decides whether to search again and with which service filter. Every call goes through
 * runTool, so bad arguments come back to the model as errors instead of crashing the run.
 * Returns how many searches succeeded.
 */
async function planSearches({
  trace,
  ctx,
  config,
  requirements,
  company,
  found,
}: SearchPlan): Promise<number> {
  const prompt = await ctx.prompts.load('match-portfolio');
  trace.addMeta({ prompt: { id: prompt.id, version: prompt.version } });

  const context = {
    requirements: {
      projectType: requirements.projectType,
      services: requirements.services,
      goals: requirements.goals,
      language: requirements.language,
    },
    company: { industry: company.industry, size: company.size, country: company.country },
  };
  const messages: LLMMessage[] = [
    { role: 'user', content: dataBlock('matching_context', JSON.stringify(context)) },
  ];

  let searches = 0;
  let successful = 0;
  for (let turn = 0; turn <= config.maxSearchTurns; turn++) {
    const result = await ctx.llm.complete({
      purpose: LLM_PURPOSES.matchPortfolio,
      system: prompt.text,
      // A snapshot: the history keeps growing after this call
      messages: [...messages],
      tools: [toToolSpec(searchPortfolioTool)],
      effort: 'low',
      ...(ctx.signal && { signal: ctx.signal }),
    });
    trace.addMeta({ usage: result.usage });
    if (result.stopReason !== 'tool_use' || result.toolCalls.length === 0) break;

    messages.push({
      role: 'assistant',
      content: result.text ?? '',
      toolCalls: result.toolCalls,
      raw: result.raw,
    });

    for (const call of result.toolCalls) {
      let content: string;
      let isError = true;
      if (call.name !== searchPortfolioTool.name) {
        content = `Unknown tool "${call.name}". Only search_portfolio is available.`;
      } else if (searches >= config.maxSearchTurns) {
        content = 'Search limit reached. Stop calling tools and summarize the results.';
      } else {
        searches++;
        const run = await trace.call(searchPortfolioTool, call.args);
        if (run.ok) {
          successful++;
          isError = false;
          keepBest(found, run.result.cases);
          content = JSON.stringify(
            run.result.cases.map(({ id, title, relevance }) => ({ id, title, relevance })),
          );
        } else {
          content = run.error;
        }
      }
      messages.push({ role: 'tool', toolCallId: call.id, content, ...(isError && { isError }) });
    }
  }
  return successful;
}

/**
 * Matching agent: finds similar past projects (LLM-planned searches plus one code-built search)
 * and scores the lead. Scoring is called by code and counts only the code-built search.
 */
export function matchingNode(deps: AgentDeps) {
  return async (state: GraphState, runConfig?: LangGraphRunnableConfig): Promise<GraphUpdate> => {
    const { requirements, company } = state;
    if (!requirements || !company) throw new Error('Matching needs research results');

    const ctx = toolsFor(deps, runConfig);
    const trace = new NodeTrace(state, 'matching', ctx);
    const found = new Map<string, MatchedCase>();
    const errors: string[] = [];

    let successful = 0;
    try {
      successful = await planSearches({
        trace,
        ctx,
        config: deps.config,
        requirements,
        company,
        found,
      });
    } catch (err) {
      const reason = err instanceof LLMError ? describeLlmFailure(err.kind, err.message) : null;
      errors.push(`Search planning failed (${reason ?? errorMessage(err)}); used keyword search`);
    }
    if (successful === 0 && errors.length === 0) {
      errors.push('Agent made no successful search; used keyword search');
    }

    // Scoring counts only cases from a query built by code: model-planned searches may enrich
    // the reply, but must not be able to add points (broad queries would always find "matches")
    const baseline = await trace.call(searchPortfolioTool, {
      query: fallbackQuery(requirements, company),
      services: requirements.services,
      limit: TOP_CASES,
    });
    const baselineCases = baseline.ok ? baseline.result.cases : [];
    keepBest(found, baselineCases);

    const matchedCases = [...found.values()]
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, TOP_CASES);

    const scored = await trace.call(scoreLeadTool, {
      requirements,
      company,
      matchedCasesCount: baselineCases.length,
    });
    if (!scored.ok) throw new Error(`Scoring failed: ${scored.error}`);

    return trace.update({ matchedCases, scoring: scored.result, errors });
  };
}
