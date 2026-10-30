import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { apiError, LLMError } from './errors.js';
import type {
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResult,
  StopReason,
  ToolSpec,
} from './types.js';
import { errorMessage } from '../error-message.js';

type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;

export type AnthropicProviderOptions = {
  apiKey: string;
  model: string;
  /** Server-side refusal fallback to another Claude model (beta). */
  fallbacks: boolean;
  baseURL?: string;
  /** Injected in tests to run the real SDK against canned HTTP responses. */
  fetch?: typeof fetch;
};

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const DEFAULT_MAX_TOKENS = 16_000;

/**
 * Claude via the Messages API. Current models reject forced `tool_choice` and sampling
 * parameters, so tools are `strict` with `auto` choice, JSON comes from native structured
 * outputs, and depth is controlled with `output_config.effort`.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  private readonly client: Anthropic;
  private readonly fallbacks: boolean;

  constructor(options: AnthropicProviderOptions) {
    this.model = options.model;
    this.fallbacks = options.fallbacks;
    this.client = new Anthropic({
      apiKey: options.apiKey,
      // Retries and timeouts are owned by ResilientProvider so every attempt is visible
      maxRetries: 0,
      ...(options.baseURL && { baseURL: options.baseURL }),
      ...(options.fetch && { fetch: options.fetch }),
    });
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    let message: Anthropic.Beta.Messages.BetaMessage;
    try {
      message = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          system: request.system,
          messages: toAnthropicMessages(request.messages),
          ...(request.tools?.length && { tools: request.tools.map(toAnthropicTool) }),
          output_config: {
            effort: request.effort ?? 'medium',
            ...(request.output && { format: jsonFormat(request.output.schema) }),
          },
          ...(this.fallbacks && { betas: [FALLBACK_BETA], fallbacks: 'default' as const }),
        },
        { signal: request.signal ?? null },
      );
    } catch (err) {
      throw toLLMError(err);
    }

    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('');
    const toolCalls = message.content.flatMap((block) =>
      block.type === 'tool_use' ? [{ id: block.id, name: block.name, args: block.input }] : [],
    );

    return {
      text: text || null,
      toolCalls,
      stopReason: toStopReason(message.stop_reason),
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
      model: message.model,
      raw: message.content,
    };
  }
}

/** JSON Schema transformed by the SDK into the subset structured outputs and strict tools accept. */
function jsonFormat(schema: z.ZodType) {
  const { type, schema: jsonSchema } = zodOutputFormat(schema);
  return { type, schema: jsonSchema };
}

function toAnthropicTool(tool: ToolSpec): Anthropic.Beta.Messages.BetaTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: jsonFormat(tool.input).schema as Anthropic.Beta.Messages.BetaTool.InputSchema,
    strict: true,
  };
}

function toAnthropicMessages(messages: LLMMessage[]): MessageParam[] {
  const result: MessageParam[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      result.push({ role: 'user', content: message.content });
    } else if (message.role === 'assistant') {
      result.push({ role: 'assistant', content: assistantContent(message) });
    } else {
      const block: ContentBlockParam = {
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: message.content,
        ...(message.isError && { is_error: true }),
      };
      // All results of one parallel tool turn must travel in a single user message
      const previous = result.at(-1);
      if (previous?.role === 'user' && Array.isArray(previous.content)) {
        previous.content.push(block);
      } else {
        result.push({ role: 'user', content: [block] });
      }
    }
  }
  return result;
}

function assistantContent(message: Extract<LLMMessage, { role: 'assistant' }>) {
  if (Array.isArray(message.raw)) return message.raw as ContentBlockParam[];
  const blocks: ContentBlockParam[] = [];
  if (message.content) blocks.push({ type: 'text', text: message.content });
  for (const call of message.toolCalls ?? []) {
    blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args });
  }
  return blocks;
}

function toStopReason(reason: string | null): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

function toLLMError(err: unknown): LLMError {
  if (err instanceof Anthropic.APIUserAbortError) {
    return new LLMError('aborted', 'Request aborted', { cause: err });
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new LLMError('timeout', 'Anthropic request timed out', { cause: err });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new LLMError('network', `Anthropic connection error: ${err.message}`, { cause: err });
  }
  if (err instanceof Anthropic.APIError) {
    return apiError(
      err.status,
      `Anthropic API error ${err.status}: ${err.message}`,
      err.headers?.get('retry-after'),
      err,
    );
  }
  return new LLMError('server', errorMessage(err), { cause: err });
}
