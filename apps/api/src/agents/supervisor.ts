import type { GraphNode, GuardFinding } from '../contracts/index.js';
import { logEvent } from '../observability/index.js';
import type { AgentConfig } from './context.js';
import type { GraphState, GraphUpdate } from './state.js';

export type Plan = { next: GraphNode; reason: string; findings?: GuardFinding[] };

/**
 * The planner. Reads what is known so far and picks the next agent. Deterministic on purpose:
 * the route through the business process must be predictable and auditable; LLMs work inside
 * the agents, not here.
 */
export function nextStep(
  state: GraphState,
  config: Pick<AgentConfig, 'maxSteps' | 'maxRewrites'>,
  now: number = Date.now(),
): Plan {
  if (state.deadline !== null && now >= state.deadline) {
    return {
      next: 'finalize',
      reason: 'time budget exhausted',
      findings: [
        {
          guard: 'output',
          code: 'time_budget_exceeded',
          severity: 'critical',
          message: 'Run stopped: the time budget ran out before all steps finished',
        },
      ],
    };
  }
  if (state.steps >= config.maxSteps) {
    return {
      next: 'finalize',
      reason: `step limit of ${config.maxSteps} reached`,
      findings: [
        {
          guard: 'output',
          code: 'step_limit_reached',
          severity: 'critical',
          message: `Run stopped after ${config.maxSteps} planning steps`,
        },
      ],
    };
  }
  if (state.inputVerdict === 'reject')
    return { next: 'finalize', reason: 'input rejected as spam' };

  if (!state.requirements) {
    return state.researchFailed
      ? { next: 'finalize', reason: 'requirements unavailable after research failed' }
      : { next: 'research', reason: 'requirements unknown' };
  }
  if (!state.scoring) return { next: 'matching', reason: 'lead not matched and scored yet' };

  if (!state.draft) {
    return state.writerFailed
      ? { next: 'finalize', reason: 'no draft after writer failed' }
      : { next: 'writer', reason: 'no reply drafted yet' };
  }
  if (!state.policyChecked) return { next: 'policy_guard', reason: 'draft not checked yet' };

  if (state.draftFindings.length > 0 && state.rewrites < config.maxRewrites) {
    return {
      next: 'writer',
      reason: `draft broke ${state.draftFindings.length} policy rule(s); rewrite ${state.rewrites + 1}/${config.maxRewrites}`,
    };
  }
  return {
    next: 'finalize',
    reason:
      state.draftFindings.length > 0 ? 'policy violations remain after rewrite' : 'all steps done',
  };
}

export function supervisorNode(config: AgentConfig) {
  return (state: GraphState): GraphUpdate => {
    const plan = nextStep(state, config);
    logEvent('supervisor.route', { step: state.steps, next: plan.next, reason: plan.reason });
    return {
      next: plan.next,
      steps: state.steps + 1,
      routeLog: [{ step: state.steps, next: plan.next, reason: plan.reason }],
      ...(plan.findings && { findings: plan.findings }),
    };
  };
}
