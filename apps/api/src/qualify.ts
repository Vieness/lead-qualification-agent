import { runLeadAgent, type LeadRun } from './agents/index.js';
import type { LeadInput, ToolCallRecord, TraceEvent } from './contracts/index.js';
import { maskPii, maskPiiDeep } from './guards/index.js';
import {
  countEvents,
  traceView,
  withRunContext,
  writeTraceFile,
  type RunContext,
} from './observability/index.js';
import type { RunFinish } from './db/repositories/index.js';
import type { Services } from './services.js';
import { errorMessage } from './error-message.js';

/** Trace records are for debugging: PII is masked before they are stored. */
function maskRecord(record: ToolCallRecord): ToolCallRecord {
  return {
    ...record,
    args: maskPiiDeep(record.args),
    result: maskPiiDeep(record.result),
    error: record.error === null ? null : maskPii(record.error),
  };
}

export type QualifyRun = LeadRun & { durationMs: number; events: TraceEvent[] };

/** What a run that failed before saving the lead records: nothing beyond time, events and error. */
const FAILED_RUN: Omit<RunFinish, 'durationMs' | 'events' | 'error'> = {
  status: 'failed',
  leadId: null,
  steps: 0,
  retries: 0,
  findings: [],
  promptVersions: {},
  routeLog: [],
  notes: [],
  usage: { inputTokens: 0, outputTokens: 0 },
};

/**
 * Qualifies one lead inside a run context (traceId-bound logger + event buffer) and records
 * the run: the agent_runs row is opened before the graph starts and always closed, as
 * "failed" with the error if the graph throws.
 */
export async function qualifyLead(
  lead: LeadInput,
  services: Services,
  options: { signal?: AbortSignal; traceDir?: string } = {},
): Promise<QualifyRun> {
  const traceId = crypto.randomUUID();
  const context: RunContext = {
    traceId,
    logger: services.logger.child({ traceId }),
    events: [],
    startedAt: Date.now(),
  };
  const { logger } = context;
  const elapsed = () => Date.now() - context.startedAt;

  return withRunContext(context, async () => {
    logger.info(
      { event: 'run.start', provider: services.llm.name, model: services.llm.model },
      'run.start',
    );
    await services.runs.start({
      traceId,
      llmProvider: services.llm.name,
      model: services.llm.model,
    });

    let run: Awaited<ReturnType<typeof runLeadAgent>>;
    try {
      run = await runLeadAgent(lead, services.agent, {
        traceId,
        ...(options.signal && { signal: options.signal }),
      });
    } catch (err) {
      // The graph failed before the lead was saved: the run is marked failed and the error surfaces
      const error = maskPii(errorMessage(err)).slice(0, 2000);
      logger.error({ event: 'run.failed', error, durationMs: elapsed() }, 'run.failed');
      await services.runs
        .finish(traceId, { ...FAILED_RUN, durationMs: elapsed(), events: context.events, error })
        .catch(() => {
          // the original error matters more than a failed bookkeeping write
        });
      throw err;
    }

    const { state, result } = run;
    const durationMs = elapsed();
    logger.info(
      {
        event: 'run.finish',
        leadId: result.leadId,
        decision: result.decision,
        status: result.status,
        score: result.score,
        tier: result.tier,
        durationMs,
        ...countEvents(context.events),
        retries: state.retries,
        ...state.usage,
      },
      'run.finish',
    );

    // The lead is saved from here on. Trace bookkeeping is best effort: failing it must not turn
    // a stored lead into a 500 that the client retries into a duplicate.
    try {
      await services.runs.recordToolCalls(state.toolCalls.map(maskRecord));
      await services.runs.finish(traceId, {
        status: result.status,
        leadId: result.leadId,
        steps: state.steps,
        retries: state.retries,
        findings: result.guardrails.findings,
        promptVersions: result.promptVersions,
        routeLog: state.routeLog,
        notes: state.errors.map(maskPii),
        usage: state.usage,
        durationMs,
        events: context.events,
        error: null,
      });
    } catch (err) {
      logger.warn(
        { event: 'run.bookkeeping_failed', leadId: result.leadId, error: maskPii(String(err)) },
        'run.bookkeeping_failed',
      );
    }

    const traceDir = options.traceDir ?? services.traceDir;
    if (traceDir) {
      try {
        const trace = await services.runs.getTrace(traceId);
        if (trace) {
          const path = await writeTraceFile(traceDir, traceView(trace));
          logger.debug({ event: 'trace.file', path }, 'trace.file');
        }
      } catch (err) {
        logger.warn({ event: 'trace.file_failed', error: String(err) }, 'trace.file_failed');
      }
    }
    return { ...run, durationMs, events: context.events };
  });
}
