import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunSummary } from '../db/repositories/index.js';
import type { ToolCallRecord } from '../contracts/index.js';

/** The public shape of a run trace: returned by GET /runs/:id/trace and written to trace files. */
export function traceView(trace: { run: RunSummary; toolCalls: ToolCallRecord[] }) {
  const { id, ...run } = trace.run;
  return { run: { traceId: id, ...run }, toolCalls: trace.toolCalls };
}

export type TraceView = ReturnType<typeof traceView>;

/** Writes `<dir>/<traceId>.json` (opt-in via TRACE_DIR or the CLI's --trace-dir). */
export async function writeTraceFile(dir: string, trace: TraceView): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${trace.run.traceId}.json`);
  await writeFile(path, `${JSON.stringify(trace, null, 2)}\n`);
  return path;
}
