import { LLMError } from './errors.js';
import type { LLMProvider, LLMRequest, LLMResult, LLMToolCall, StopReason } from './types.js';

/** Rough token count (≈4 characters per token) so keyless demo traces show realistic usage. */
function estimateUsage(request: LLMRequest, text: string | null, toolCalls: LLMToolCall[]) {
  const tokens = (chars: number) => Math.ceil(chars / 4);
  const input = request.system.length + request.messages.reduce((n, m) => n + m.content.length, 0);
  const output = (text?.length ?? 0) + JSON.stringify(toolCalls).length - 2;
  return { inputTokens: tokens(input), outputTokens: tokens(Math.max(0, output)) };
}

/** A scripted answer. `json` is serialized into `text`, which is handy for structured outputs. */
export type MockReply =
  | {
      text?: string;
      json?: unknown;
      toolCalls?: LLMToolCall[];
      stopReason?: StopReason;
    }
  | LLMError;

export type MockResponder =
  MockReply | MockReply[] | ((request: LLMRequest) => MockReply | Promise<MockReply>);

/**
 * Deterministic provider for tests and keyless demos. Answers by `request.purpose`; an array
 * is a queue (the last reply repeats once the queue is drained). Every request is recorded.
 */
export class MockProvider implements LLMProvider {
  readonly name = 'mock' as const;
  readonly model = 'mock';
  readonly calls: LLMRequest[] = [];
  private readonly script = new Map<string, MockResponder>();

  constructor(script: Record<string, MockResponder> = {}) {
    for (const [purpose, responder] of Object.entries(script)) this.script.set(purpose, responder);
  }

  on(purpose: string, responder: MockResponder): this {
    this.script.set(purpose, responder);
    return this;
  }

  callsFor(purpose: string): LLMRequest[] {
    return this.calls.filter((call) => call.purpose === purpose);
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    this.calls.push(request);
    if (request.signal?.aborted) throw new LLMError('aborted', 'Request aborted');

    const reply = await this.nextReply(request);
    if (reply instanceof LLMError) throw reply;

    const text = reply.json !== undefined ? JSON.stringify(reply.json) : (reply.text ?? null);
    const toolCalls = reply.toolCalls ?? [];
    return {
      text,
      toolCalls,
      stopReason: reply.stopReason ?? (toolCalls.length > 0 ? 'tool_use' : 'end'),
      usage: estimateUsage(request, text, toolCalls),
      model: this.model,
    };
  }

  private async nextReply(request: LLMRequest): Promise<MockReply> {
    const responder = this.script.get(request.purpose);
    if (responder === undefined) {
      throw new LLMError(
        'bad_request',
        `MockProvider has no reply for purpose "${request.purpose}"`,
      );
    }
    if (typeof responder === 'function') return responder(request);
    if (Array.isArray(responder)) {
      const reply = responder.length > 1 ? responder.shift() : responder[0];
      if (reply === undefined) {
        throw new LLMError('bad_request', `Empty mock queue for "${request.purpose}"`);
      }
      return reply;
    }
    return responder;
  }
}
