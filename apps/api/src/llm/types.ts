import type { z } from 'zod';

export type LLMProviderName = 'anthropic' | 'openai-compatible' | 'mock';

export type LLMToolCall = {
  id: string;
  name: string;
  /** Parsed JSON arguments; the raw string if the model produced invalid JSON. Validate before use. */
  args: unknown;
};

export type LLMMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: LLMToolCall[];
      /**
       * Provider-native assistant content (e.g. Claude thinking + tool_use blocks). Replayed
       * unchanged when the same provider sees the history again, so nothing is lost or edited.
       */
      raw?: unknown;
    }
  | { role: 'tool'; toolCallId: string; content: string; isError?: boolean };

export type ToolSpec = {
  name: string;
  description: string;
  input: z.ZodType;
};

export type OutputSpec = {
  /** Short identifier of the output shape, e.g. "requirements". */
  name: string;
  schema: z.ZodType;
};

export type Effort = 'low' | 'medium' | 'high';

export type LLMRequest = {
  /** What the call is for, e.g. "research.extract_requirements". Used for tracing and by the mock. */
  purpose: string;
  system: string;
  messages: LLMMessage[];
  tools?: ToolSpec[];
  /** Ask for a JSON object matching this schema (native structured outputs where supported). */
  output?: OutputSpec;
  /** Reasoning depth: Claude's output_config.effort; reasoning_effort for OpenAI-compatible models when enabled. */
  effort?: Effort;
  maxTokens?: number;
  signal?: AbortSignal;
};

export type StopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

export type TokenUsage = { inputTokens: number; outputTokens: number };

export type LLMResult = {
  text: string | null;
  toolCalls: LLMToolCall[];
  stopReason: StopReason;
  usage: TokenUsage;
  /** Model that actually answered (may differ from the requested one after a fallback). */
  model: string | null;
  /** Provider-native assistant content, to pass back via LLMMessage.raw. */
  raw?: unknown;
};

export interface LLMProvider {
  readonly name: LLMProviderName;
  readonly model: string | null;
  complete(request: LLMRequest): Promise<LLMResult>;
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}
