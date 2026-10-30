import { AsyncLocalStorage } from 'node:async_hooks';
import type { TraceEvent } from '../contracts/index.js';
import type { RetryInfo } from '../llm/index.js';
import type { Logger } from './logger.js';

/** Everything that belongs to one agent run, reachable from any code running inside it. */
export type RunContext = {
  traceId: string;
  /** Child logger: every line carries the traceId. */
  logger: Logger;
  /** LLM calls and retries, persisted with the run. */
  events: TraceEvent[];
  startedAt: number;
};

const storage = new AsyncLocalStorage<RunContext>();

/**
 * Runs `fn` with `context` as the current run. Async work started inside (graph nodes, tools,
 * the shared LLM provider) sees the same context, so a retry deep in the provider is still
 * attributed to the right traceId without passing a logger through every call.
 */
export function withRunContext<T>(context: RunContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

export function currentRun(): RunContext | undefined {
  return storage.getStore();
}

type Fields = Record<string, unknown>;

/** Structured event in the current run's log; a no-op outside a run. */
export function logEvent(
  event: string,
  fields: Fields = {},
  level: 'info' | 'warn' | 'debug' = 'info',
): void {
  currentRun()?.logger[level]({ event, ...fields }, event);
}

/** Hooked into ResilientProvider.onRetry: records and logs the retry for the current run. */
export function recordRetry({ purpose, attempt, delayMs, error }: RetryInfo): void {
  const run = currentRun();
  if (!run) return;
  run.events.push({
    type: 'llm_retry',
    at: new Date().toISOString(),
    purpose,
    attempt,
    delayMs,
    errorKind: error.kind,
  });
  run.logger.warn(
    { event: 'llm.retry', purpose, attempt, delayMs, errorKind: error.kind },
    'llm.retry',
  );
}

/** How many LLM calls and retries a run made, from its event buffer. */
export function countEvents(events: TraceEvent[]): { llmCalls: number; llmRetries: number } {
  return {
    llmCalls: events.filter((e) => e.type === 'llm_call').length,
    llmRetries: events.filter((e) => e.type === 'llm_retry').length,
  };
}

/** True when a call in the run failed because the provider quota is spent. */
export function hitQuota(events: TraceEvent[]): boolean {
  return events.some((e) => e.type === 'llm_call' && e.error?.startsWith('quota_exhausted'));
}
