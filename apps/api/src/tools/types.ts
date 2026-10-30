import { z } from 'zod';
import type { ToolName } from '../contracts/index.js';
import type { LeadRepository, PortfolioRepository } from '../db/repositories/index.js';
import { LLMError, type LLMProvider, type LLMErrorKind, type TokenUsage } from '../llm/index.js';
import type { PromptLoader } from '../prompts/loader.js';
import type { CompanyDirectory } from './company-directory.js';
import { errorMessage } from '../error-message.js';

/** Everything a tool may use. Built once per run by the orchestrator; tests pass fakes. */
export type ToolContext = {
  llm: LLMProvider;
  prompts: PromptLoader;
  portfolio: PortfolioRepository;
  leads: LeadRepository;
  companies: CompanyDirectory;
  /** Extra attempts for invalid LLM output. */
  maxRetries: number;
  signal?: AbortSignal;
};

/** Present for tools that call the LLM; recorded in the trace and in AgentState. */
export type ToolMeta = {
  prompt?: { id: string; version: string };
  retries?: number;
  usage?: TokenUsage;
  model?: string | null;
};

export type ToolOutput<T> = { data: T; meta?: ToolMeta };

export interface Tool<In extends z.ZodType = z.ZodType, Out extends z.ZodType = z.ZodType> {
  name: ToolName;
  /** Shown to the LLM when the tool is offered in a tool-use loop. */
  description: string;
  input: In;
  output: Out;
  execute(input: z.output<In>, ctx: ToolContext): Promise<ToolOutput<z.output<Out>>>;
}

/** Identity helper that keeps input/output types linked to the schemas. */
export function defineTool<In extends z.ZodType, Out extends z.ZodType>(
  tool: Tool<In, Out>,
): Tool<In, Out> {
  return tool;
}

export type ToolErrorKind = 'invalid_args' | 'invalid_output' | 'tool_error' | LLMErrorKind;

export type ToolRun<T> = {
  tool: ToolName;
  args: unknown;
  startedAt: string;
  latencyMs: number;
} & (
  { ok: true; result: T; meta: ToolMeta } | { ok: false; error: string; errorKind: ToolErrorKind }
);

/**
 * Runs a tool safely: validates the (possibly LLM-produced) arguments, executes, validates the
 * output and measures latency. Never throws for bad input or a failing tool: the error is
 * returned so the agent can show it to the model or escalate.
 */
export async function runTool<In extends z.ZodType, Out extends z.ZodType>(
  tool: Tool<In, Out>,
  args: unknown,
  ctx: ToolContext,
): Promise<ToolRun<z.output<Out>>> {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const base = () => ({
    tool: tool.name,
    args,
    startedAt,
    latencyMs: Math.round(performance.now() - started),
  });

  const input = tool.input.safeParse(args);
  if (!input.success) {
    return {
      ...base(),
      ok: false,
      errorKind: 'invalid_args',
      error: `Invalid arguments for ${tool.name}:\n${z.prettifyError(input.error)}`,
    };
  }

  try {
    const { data, meta = {} } = await tool.execute(input.data, ctx);
    const output = tool.output.safeParse(data);
    if (!output.success) {
      return {
        ...base(),
        ok: false,
        errorKind: 'invalid_output',
        error: `${tool.name} produced invalid output:\n${z.prettifyError(output.error)}`,
      };
    }
    return { ...base(), ok: true, result: output.data, meta };
  } catch (err) {
    return {
      ...base(),
      ok: false,
      errorKind: err instanceof LLMError ? err.kind : 'tool_error',
      error: errorMessage(err),
    };
  }
}
