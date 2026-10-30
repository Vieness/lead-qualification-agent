import { END, START, StateGraph, type LangGraphRunnableConfig } from '@langchain/langgraph';
import {
  createInitialState,
  QualificationResultSchema,
  type AgentState,
  type GraphNode,
  type LeadInput,
  type QualificationResult,
} from '../contracts/index.js';
import { saveToCrmTool } from '../tools/index.js';
import { NodeTrace, toolsFor, type AgentDeps, type RunConfigurable } from './context.js';
import { finalizeNode } from './finalize.js';
import { inputGuardNode, policyGuardNode } from './guard-nodes.js';
import { matchingNode } from './matching.js';
import { researchNode } from './research.js';
import { AgentStateAnnotation, type GraphState, type GraphUpdate } from './state.js';
import { supervisorNode } from './supervisor.js';
import { writerNode } from './writer.js';

const ROUTES: GraphNode[] = ['research', 'matching', 'writer', 'policy_guard', 'finalize'];

function saveNode(deps: AgentDeps) {
  return async (state: GraphState, runConfig?: LangGraphRunnableConfig): Promise<GraphUpdate> => {
    if (!state.outcome) throw new Error('Nothing to save: finalize produced no outcome');
    const trace = new NodeTrace(state, 'supervisor', toolsFor(deps, runConfig));
    const saved = await trace.call(saveToCrmTool, { lead: state.lead, outcome: state.outcome });
    if (!saved.ok) throw new Error(`Saving the lead failed: ${saved.error}`);
    return trace.update({ leadId: saved.result.leadId });
  };
}

/**
 * input_guard → supervisor ⇄ {research, matching, writer, policy_guard} → finalize → save.
 * The supervisor plans every hop; the recursion limit is only a backstop for a planner bug.
 */
function compileGraph(deps: AgentDeps) {
  return new StateGraph(AgentStateAnnotation)
    .addNode('input_guard', inputGuardNode)
    .addNode('supervisor', supervisorNode(deps.config))
    .addNode('research', researchNode(deps))
    .addNode('matching', matchingNode(deps))
    .addNode('writer', writerNode(deps))
    .addNode('policy_guard', policyGuardNode)
    .addNode('finalize', finalizeNode)
    .addNode('save', saveNode(deps))
    .addEdge(START, 'input_guard')
    .addEdge('input_guard', 'supervisor')
    .addConditionalEdges('supervisor', (state) => state.next ?? 'finalize', ROUTES)
    .addEdge('research', 'supervisor')
    .addEdge('matching', 'supervisor')
    .addEdge('writer', 'supervisor')
    .addEdge('policy_guard', 'supervisor')
    .addEdge('finalize', 'save')
    .addEdge('save', END)
    .compile();
}

const compiledGraphs = new WeakMap<AgentDeps, ReturnType<typeof compileGraph>>();

/** Compiled once per set of dependencies and reused by every run. */
export function buildGraph(deps: AgentDeps) {
  let graph = compiledGraphs.get(deps);
  if (!graph) {
    graph = compileGraph(deps);
    compiledGraphs.set(deps, graph);
  }
  return graph;
}

export type LeadRun = { result: QualificationResult; state: AgentState };

/** Runs the whole qualification for one lead and returns the stored result plus the full state (trace). */
export async function runLeadAgent(
  lead: LeadInput,
  deps: AgentDeps,
  options: { traceId?: string; signal?: AbortSignal } = {},
): Promise<LeadRun> {
  const traceId = options.traceId ?? crypto.randomUUID();
  const graph = buildGraph(deps);

  // The signal only cancels LLM calls (via the tool context). The graph itself keeps running so a
  // cancelled or slow run still ends in finalize → save, with the failures recorded as findings.
  const deadline = Date.now() + deps.config.runBudgetMs;
  const configurable: RunConfigurable = options.signal ? { llmSignal: options.signal } : {};
  const state: AgentState = await graph.invoke(createInitialState(traceId, lead, deadline), {
    recursionLimit: deps.config.maxSteps * 2 + 10,
    configurable,
  });

  if (!state.outcome || !state.leadId)
    throw new Error('Agent run finished without a saved outcome');
  return {
    result: QualificationResultSchema.parse({ ...state.outcome, leadId: state.leadId }),
    state,
  };
}
