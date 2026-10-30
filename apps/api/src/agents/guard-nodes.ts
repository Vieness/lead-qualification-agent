import { checkDraft, inspectLead } from '../guards/index.js';
import type { GraphState, GraphUpdate } from './state.js';

/** First node: spam is rejected before any LLM call; suspected injection forces review. */
export function inputGuardNode(state: GraphState): GraphUpdate {
  const result = inspectLead(state.lead);
  return {
    inputVerdict: result.verdict,
    injectionDetected: result.injectionDetected,
    findings: result.findings,
  };
}

/** Checks the current draft with code. Findings replace those of any earlier draft. */
export function policyGuardNode(state: GraphState): GraphUpdate {
  const draftFindings = state.draft ? checkDraft(state.draft) : [];
  return {
    policyChecked: true,
    draftFindings,
    ...(draftFindings.some((f) => f.code === 'prompt_injection') && { injectionDetected: true }),
  };
}
