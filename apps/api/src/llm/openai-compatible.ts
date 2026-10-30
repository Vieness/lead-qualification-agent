import OpenAI from 'openai';
import { z } from 'zod';
import { apiError, LLMError } from './errors.js';
import type {
  LLMMessage,
  LLMProvider,
  LLMRequest,
  LLMResult,
  LLMToolCall,
  StopReason,
  ToolSpec,
} from './types.js';
import { errorMessage } from '../error-message.js';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export type OpenAICompatibleProviderOptions = {
  model: string;
  /** Not needed by local servers such as Ollama. */
  apiKey?: string;
  /** Groq, OpenRouter, Gemini, Ollama… Empty = api.openai.com. */
  baseURL?: string;
  /**
   * Send the request's effort as `reasoning_effort`. Reasoning models (gpt-oss, o-series)
   * otherwise think at their default depth, and hidden reasoning is billed as output tokens.
   */
  reasoningEffort?: boolean;
  fetch?: typeof fetch;
};

const DEFAULT_MAX_TOKENS = 4_096;

/**
 * Any server that speaks the OpenAI Chat Completions API. Uses Chat Completions (not the
 * Responses API) because that is what Groq, OpenRouter, Gemini and Ollama implement.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly name = 'openai-compatible' as const;
  readonly model: string;
  private readonly client: OpenAI;
  private readonly reasoningEffort: boolean;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.model = options.model;
    this.reasoningEffort = options.reasoningEffort ?? false;
    this.client = new OpenAI({
      apiKey: options.apiKey ?? 'not-needed',
      maxRetries: 0,
      ...(options.baseURL && { baseURL: options.baseURL }),
      ...(options.fetch && { fetch: options.fetch }),
    });
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    let completion: OpenAI.Chat.Completions.ChatCompletion;
    try {
      completion = await this.client.chat.completions.create(
        {
          model: this.model,
          // max_tokens (not max_completion_tokens) is the field every compatible server accepts
          max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: 0,
          ...(this.reasoningEffort && request.effort && { reasoning_effort: request.effort }),
          messages: [
            { role: 'system', content: request.system },
            ...toChatMessages(request.messages),
          ],
          ...(request.tools?.length && { tools: request.tools.map(toFunctionTool) }),
          ...(request.output && {
            response_format: {
              type: 'json_schema' as const,
              json_schema: {
                name: request.output.name,
                schema: z.toJSONSchema(request.output.schema),
              },
            },
          }),
        },
        { signal: request.signal ?? null },
      );
    } catch (err) {
      throw toLLMError(err);
    }

    const choice = completion.choices[0];
    if (!choice) throw new LLMError('server', 'Completion returned no choices');

    return {
      text: choice.message.content ?? null,
      toolCalls: (choice.message.tool_calls ?? []).flatMap(toToolCall),
      stopReason: toStopReason(choice.finish_reason),
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      },
      model: completion.model,
    };
  }
}

function toFunctionTool(tool: ToolSpec): OpenAI.Chat.Completions.ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.input, { io: 'input' }),
    },
  };
}

function toChatMessages(messages: LLMMessage[]): ChatMessage[] {
  return messages.map((message): ChatMessage => {
    if (message.role === 'user') return { role: 'user', content: message.content };
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    }
    return {
      role: 'assistant',
      content: message.content || null,
      ...(message.toolCalls?.length && {
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.name, arguments: JSON.stringify(call.args) },
        })),
      }),
    };
  });
}

function toToolCall(call: OpenAI.Chat.Completions.ChatCompletionMessageToolCall): LLMToolCall[] {
  if (call.type !== 'function') return [];
  let args: unknown = call.function.arguments;
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    // keep the raw string; the tool's Zod schema rejects it and the model gets the error back
  }
  return [{ id: call.id, name: call.function.name, args }];
}

function toStopReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'stop':
      return 'end';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    default:
      return 'other';
  }
}

function toLLMError(err: unknown): LLMError {
  if (err instanceof OpenAI.APIUserAbortError) {
    return new LLMError('aborted', 'Request aborted', { cause: err });
  }
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return new LLMError('timeout', 'LLM request timed out', { cause: err });
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return new LLMError('network', `LLM connection error: ${err.message}`, { cause: err });
  }
  if (err instanceof OpenAI.APIError) {
    return apiError(
      err.status,
      `LLM API error ${err.status}: ${err.message}`,
      err.headers?.get('retry-after'),
      err,
    );
  }
  return new LLMError('server', errorMessage(err), { cause: err });
}
