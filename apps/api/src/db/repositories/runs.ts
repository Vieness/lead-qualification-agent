import { asc, eq } from 'drizzle-orm';
import type {
  GuardFinding,
  RouteStep,
  RunStatus,
  ToolCallRecord,
  TraceEvent,
} from '../../contracts/index.js';
import type { Db } from '../client.js';
import { agentRuns, toolCalls } from '../schema.js';

export type RunSummary = typeof agentRuns.$inferSelect;

export type RunFinish = {
  status: RunStatus;
  leadId: string | null;
  steps: number;
  retries: number;
  findings: GuardFinding[];
  promptVersions: Record<string, string>;
  routeLog: RouteStep[];
  notes: string[];
  usage: { inputTokens: number; outputTokens: number };
  durationMs: number;
  events: TraceEvent[];
  error: string | null;
};

export class RunRepository {
  constructor(private readonly db: Db) {}

  async start(run: { traceId: string; llmProvider: string; model: string | null }): Promise<void> {
    await this.db.insert(agentRuns).values({
      id: run.traceId,
      llmProvider: run.llmProvider,
      model: run.model,
    });
  }

  async recordToolCall(record: ToolCallRecord): Promise<void> {
    await this.recordToolCalls([record]);
  }

  async recordToolCalls(records: ToolCallRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.db.insert(toolCalls).values(
      records.map((record) => ({
        runId: record.traceId,
        step: record.step,
        agent: record.agent,
        tool: record.tool,
        args: record.args ?? {},
        result: record.result,
        error: record.error,
        latencyMs: Math.round(record.latencyMs),
        startedAt: new Date(record.startedAt),
      })),
    );
  }

  async finish(traceId: string, finish: RunFinish): Promise<void> {
    await this.db
      .update(agentRuns)
      .set({ ...finish, finishedAt: new Date() })
      .where(eq(agentRuns.id, traceId));
  }

  /** The run plus its tool calls in execution order, or null for an unknown traceId. */
  async getTrace(
    traceId: string,
  ): Promise<{ run: RunSummary; toolCalls: ToolCallRecord[] } | null> {
    const [run] = await this.db.select().from(agentRuns).where(eq(agentRuns.id, traceId));
    if (!run) return null;

    const rows = await this.db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.runId, traceId))
      .orderBy(asc(toolCalls.step));

    return {
      run,
      toolCalls: rows.map((row) => ({
        traceId: row.runId,
        step: row.step,
        agent: row.agent,
        tool: row.tool,
        args: row.args,
        result: row.result,
        error: row.error,
        latencyMs: row.latencyMs,
        startedAt: row.startedAt.toISOString(),
      })),
    };
  }
}
