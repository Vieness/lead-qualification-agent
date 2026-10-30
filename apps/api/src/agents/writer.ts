import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { draftReplyTool } from '../tools/index.js';
import { failureText, llmFailureFinding, NodeTrace, toolsFor, type AgentDeps } from './context.js';
import type { GraphState, GraphUpdate } from './state.js';

/**
 * Writer agent: drafts the reply. On a second visit (after the policy guard found problems)
 * it passes the violations back as feedback; if that rewrite fails, the flagged draft stays
 * and the lead goes to a human.
 */
export function writerNode(deps: AgentDeps) {
  return async (state: GraphState, runConfig?: LangGraphRunnableConfig): Promise<GraphUpdate> => {
    const { requirements, scoring } = state;
    if (!requirements || !scoring) throw new Error('Writer needs requirements and scoring');

    const trace = new NodeTrace(state, 'writer', toolsFor(deps, runConfig));
    const isRewrite = state.draft !== null;

    const run = await trace.call(draftReplyTool, {
      leadName: state.lead.name,
      language: state.replyLanguage ?? 'en',
      requirements,
      matchedCases: state.matchedCases,
      tier: scoring.tier,
      missingInfo: requirements.missingInfo,
      policyFeedback: isRewrite ? state.draftFindings.map((f) => f.message) : [],
    });

    if (run.ok) {
      return trace.update({
        draft: run.result,
        policyChecked: false,
        draftFindings: [],
        rewrites: isRewrite ? state.rewrites + 1 : state.rewrites,
      });
    }
    if (isRewrite) {
      return trace.update({
        rewrites: state.rewrites + 1,
        errors: [`Rewrite failed: ${failureText(run)}`],
      });
    }
    return trace.update({
      writerFailed: true,
      findings: [llmFailureFinding('writer', run)],
      errors: [`Drafting the reply failed: ${failureText(run)}`],
    });
  };
}
