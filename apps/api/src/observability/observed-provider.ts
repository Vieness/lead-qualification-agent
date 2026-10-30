import { maskPii } from '../guards/index.js';
import { LLMError, type LLMProvider, type LLMRequest, type LLMResult } from '../llm/index.js';
import { currentRun } from './run-context.js';
import { errorMessage } from '../error-message.js';

/**
 * Decorator that records every logical LLM call (latency, tokens, stop reason, failure) in the
 * current run and its log. Wraps the resilient provider, so one entry covers all attempts;
 * the attempts themselves show up as llm_retry events.
 */
export class ObservedProvider implements LLMProvider {
  constructor(private readonly inner: LLMProvider) {}

  get name() {
    return this.inner.name;
  }

  get model() {
    return this.inner.model;
  }

  async complete(request: LLMRequest): Promise<LLMResult> {
    const at = new Date().toISOString();
    const started = performance.now();
    try {
      const result = await this.inner.complete(request);
      this.record(request, at, started, {
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        stopReason: result.stopReason,
        error: null,
      });
      return result;
    } catch (err) {
      const kind = err instanceof LLMError ? err.kind : 'unknown';
      this.record(request, at, started, {
        model: this.inner.model,
        inputTokens: 0,
        outputTokens: 0,
        stopReason: null,
        error: `${kind}: ${maskPii(errorMessage(err))}`.slice(0, 2000),
      });
      throw err;
    }
  }

  private record(
    request: LLMRequest,
    at: string,
    started: number,
    outcome: {
      model: string | null;
      inputTokens: number;
      outputTokens: number;
      stopReason: string | null;
      error: string | null;
    },
  ): void {
    const run = currentRun();
    if (!run) return;
    const latencyMs = Math.round(performance.now() - started);
    run.events.push({ type: 'llm_call', at, purpose: request.purpose, latencyMs, ...outcome });
    const level = outcome.error ? 'warn' : 'info';
    run.logger[level](
      { event: 'llm.call', purpose: request.purpose, latencyMs, ...outcome },
      'llm.call',
    );
  }
}
