import { Annotation } from '@langchain/langgraph';
import type { AgentState } from '../contracts/index.js';
import { addUsage } from '../llm/index.js';

// LangGraph channels for AgentState (contracts/agent-state.ts). Nodes return partial updates:
// "last" fields are overwritten, "append" fields accumulate across nodes.

const last = <K extends keyof AgentState>(initial: () => AgentState[K]) =>
  Annotation<AgentState[K]>({ reducer: (_current, update) => update, default: initial });

const append = <K extends keyof AgentState>() =>
  Annotation<AgentState[K] & unknown[]>({
    reducer: (current, update) => [...current, ...update] as AgentState[K] & unknown[],
    default: () => [] as unknown as AgentState[K] & unknown[],
  });

export const AgentStateAnnotation = Annotation.Root({
  traceId: last<'traceId'>(() => ''),
  lead: Annotation<AgentState['lead']>,

  inputVerdict: last<'inputVerdict'>(() => null),
  injectionDetected: Annotation<boolean>({ reducer: (a, b) => a || b, default: () => false }),
  requirements: last<'requirements'>(() => null),
  company: last<'company'>(() => null),
  replyLanguage: last<'replyLanguage'>(() => null),
  researchFailed: last<'researchFailed'>(() => false),
  matchedCases: last<'matchedCases'>(() => []),
  scoring: last<'scoring'>(() => null),
  draft: last<'draft'>(() => null),
  writerFailed: last<'writerFailed'>(() => false),
  policyChecked: last<'policyChecked'>(() => false),
  draftFindings: last<'draftFindings'>(() => []),
  rewrites: last<'rewrites'>(() => 0),

  findings: append<'findings'>(),
  errors: append<'errors'>(),
  toolCalls: append<'toolCalls'>(),
  routeLog: append<'routeLog'>(),
  promptVersions: Annotation<AgentState['promptVersions']>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
  retries: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }),
  usage: Annotation<AgentState['usage']>({
    reducer: addUsage,
    default: () => ({ inputTokens: 0, outputTokens: 0 }),
  }),

  steps: last<'steps'>(() => 0),
  deadline: last<'deadline'>(() => null),
  next: last<'next'>(() => null),
  outcome: last<'outcome'>(() => null),
  leadId: last<'leadId'>(() => null),
});

export type GraphState = typeof AgentStateAnnotation.State;
export type GraphUpdate = typeof AgentStateAnnotation.Update;
