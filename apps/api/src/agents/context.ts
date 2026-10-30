import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { z } from 'zod';
import type { AgentName, GuardCode, GuardFinding, ToolCallRecord } from '../contracts/index.js';
import { addUsage, describeLlmFailure, type TokenUsage } from '../llm/index.js';
import { logEvent, shapeOf } from '../observability/index.js';
import {
  runTool,
  type Tool,
  type ToolContext,
  type ToolMeta,
  type ToolRun,
} from '../tools/index.js';
import type { GraphState, GraphUpdate } from './state.js';

export type AgentConfig = {
  /** Supervisor routing decisions before the run is stopped for human review. */
  maxSteps: number;
  approvalThresholdUsd: number;
  /** Tool calls the matching agent may make on its own. */
  maxSearchTurns: number;
  /** Rewrites the writer gets after a policy violation. */
  maxRewrites: number;
  /** Wall-clock budget for one run; past it the supervisor finalizes for human review. */
  runBudgetMs: number;
};

export type AgentDeps = { tools: ToolContext; config: AgentConfig };

/** Per-run values travel in LangGraph's `configurable`, so one compiled graph serves every run. */
export type RunConfigurable = { llmSignal?: AbortSignal };

/** The tool context for this run: the shared one, plus the run's cancellation signal if any. */
export function toolsFor(deps: AgentDeps, config?: LangGraphRunnableConfig): ToolContext {
  const signal: unknown = config?.configurable?.llmSignal;
  return signal instanceof AbortSignal ? { ...deps.tools, signal } : deps.tools;
}

/**
 * Collects what one node did (tool calls, prompt versions, retries, tokens) and turns it into
 * the state update. Tool call records are numbered across the whole run.
 */
export class NodeTrace {
  private readonly toolCalls: ToolCallRecord[] = [];
  private readonly promptVersions: Record<string, string> = {};
  private retries = 0;
  private usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  constructor(
    private readonly state: GraphState,
    private readonly agent: AgentName,
    private readonly ctx: ToolContext,
  ) {}

  async call<In extends z.ZodType, Out extends z.ZodType>(
    tool: Tool<In, Out>,
    args: unknown,
  ): Promise<ToolRun<z.output<Out>>> {
    const run = await runTool(tool, args, this.ctx);
    this.toolCalls.push({
      traceId: this.state.traceId,
      step: this.state.toolCalls.length + this.toolCalls.length,
      agent: this.agent,
      tool: tool.name,
      args,
      result: run.ok ? run.result : null,
      error: run.ok ? null : run.error,
      latencyMs: run.latencyMs,
      startedAt: run.startedAt,
    });
    if (run.ok) this.addMeta(run.meta);

    const record = this.toolCalls[this.toolCalls.length - 1];
    logEvent(
      'tool.call',
      {
        step: record?.step,
        agent: this.agent,
        tool: tool.name,
        latencyMs: run.latencyMs,
        ok: run.ok,
        ...(!run.ok && { errorKind: run.errorKind }),
      },
      run.ok ? 'info' : 'warn',
    );
    // Debug level shows the shape of the payload only: names and free text cannot be masked
    logEvent(
      'tool.io',
      {
        step: record?.step,
        tool: tool.name,
        args: shapeOf(args),
        result: shapeOf(record?.result ?? null),
      },
      'debug',
    );
    return run;
  }

  addMeta(meta: ToolMeta): void {
    if (meta.prompt) this.promptVersions[meta.prompt.id] = meta.prompt.version;
    this.retries += meta.retries ?? 0;
    if (meta.usage) this.usage = addUsage(this.usage, meta.usage);
  }

  /** The node's own fields merged with everything traced. */
  update(fields: GraphUpdate): GraphUpdate {
    return {
      ...fields,
      toolCalls: this.toolCalls,
      promptVersions: this.promptVersions,
      retries: this.retries,
      usage: this.usage,
    };
  }
}

/** What a failed tool call says to people: a plain reason for provider failures, else its error. */
export function failureText(run: Extract<ToolRun<unknown>, { ok: false }>): string {
  return describeLlmFailure(run.errorKind, run.error) ?? run.error.slice(0, 300);
}

/** Maps a failed LLM-backed tool to the guard finding that sends the lead to a human. */
export function llmFailureFinding(
  agent: AgentName,
  run: Extract<ToolRun<unknown>, { ok: false }>,
): GuardFinding {
  const code: GuardCode =
    run.errorKind === 'invalid_output' || run.errorKind === 'invalid_args'
      ? 'invalid_llm_output'
      : 'llm_unavailable';
  return {
    guard: 'output',
    code,
    severity: 'critical',
    message: `${agent} agent: ${run.tool} failed (${run.errorKind}): ${failureText(run)}`,
  };
}
