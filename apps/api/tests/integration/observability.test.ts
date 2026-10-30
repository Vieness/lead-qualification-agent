import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { LeadInputSchema } from '../../src/contracts/index.js';
import { createMemoryDb } from '../../src/db/memory.js';
import type { Db } from '../../src/db/client.js';
import { RunRepository } from '../../src/db/repositories/index.js';
import { traceView } from '../../src/observability/index.js';
import { qualifyLead, type QualifyRun } from '../../src/qualify.js';
import { createServices, type Services } from '../../src/services.js';
import { memoryLogger } from '../helpers/memory-logger.js';

const EMAIL = 'olena.k@brewlane.co';
const PHONE = '+380 67 123 45 67';
const lead = LeadInputSchema.parse({
  name: 'Olena Kovalenko',
  email: EMAIL,
  company: 'Brewlane Coffee',
  message: `We need a loyalty mobile app for our coffee chain, budget $40k, launch in 3 months. Call ${PHONE}.`,
});

let db: Db;
let closeDb: () => Promise<void>;
let services: Services;
let log: ReturnType<typeof memoryLogger>;
let traceDir: string;
let run: QualifyRun;

beforeAll(async () => {
  ({ db, close: closeDb } = await createMemoryDb({ seed: true }));
  log = memoryLogger('debug');
  traceDir = await mkdtemp(join(tmpdir(), 'traces-'));
  services = await createServices(
    loadEnv({ LLM_PROVIDER: 'mock', LOG_LEVEL: 'silent', TRACE_DIR: traceDir }),
    { db, logger: log.logger },
  );
  run = await qualifyLead(lead, services);
});
afterAll(async () => {
  await services.close();
  await closeDb();
  await rm(traceDir, { recursive: true, force: true });
});

describe('run events in the log', () => {
  it('tells the story of the run in order, every line tagged with the traceId', () => {
    const events = log
      .lines()
      .filter((l) => l.level === 30)
      .map((l) => l.event);
    expect(events).toEqual([
      'run.start',
      'supervisor.route',
      'llm.call',
      'tool.call',
      'tool.call',
      'supervisor.route',
      'llm.call',
      'tool.call',
      'llm.call',
      'tool.call',
      'tool.call',
      'supervisor.route',
      'llm.call',
      'tool.call',
      'supervisor.route',
      'supervisor.route',
      'tool.call',
      'run.finish',
    ]);
    expect(log.lines().every((l) => l.traceId === run.result.traceId)).toBe(true);
  });

  it('summarises the run in run.finish', () => {
    const finish = log.lines().find((l) => l.event === 'run.finish');
    expect(finish).toMatchObject({
      decision: 'auto_reply',
      llmCalls: 4,
      llmRetries: 0,
      inputTokens: run.state.usage.inputTokens,
      outputTokens: run.state.usage.outputTokens,
    });
    expect(run.state.usage.inputTokens).toBeGreaterThan(0);
  });

  it('never writes the email, phone, name or message text, even at debug level', () => {
    const raw = log.raw();
    expect(log.lines().some((l) => l.event === 'tool.io')).toBe(true);
    for (const secret of [
      EMAIL,
      PHONE,
      '123 45 67',
      'Kovalenko',
      'loyalty mobile app for our coffee chain',
    ]) {
      expect(raw).not.toContain(secret);
    }
  });
});

describe('persisted trace', () => {
  it('stores usage, duration and LLM events with the run', async () => {
    const trace = await services.runs.getTrace(run.result.traceId);
    expect(trace?.run).toMatchObject({
      usage: run.state.usage,
      durationMs: run.durationMs,
    });
    expect(trace?.run.events.map((e) => (e.type === 'llm_call' ? e.purpose : e.type))).toEqual([
      'extract_requirements',
      'match_portfolio',
      'match_portfolio',
      'draft_reply',
    ]);
  });

  it('writes the same trace to TRACE_DIR when configured', async () => {
    const file = JSON.parse(await readFile(join(traceDir, `${run.result.traceId}.json`), 'utf8'));
    const trace = await services.runs.getTrace(run.result.traceId);
    expect(file).toEqual(JSON.parse(JSON.stringify(traceView(trace!))));
    expect(JSON.stringify(file)).not.toContain(EMAIL);
  });
});

describe('bookkeeping after the lead is saved', () => {
  class BrokenRuns extends RunRepository {
    override async recordToolCalls(): Promise<void> {
      throw new Error('tool_calls insert failed');
    }
  }

  it('returns the stored result instead of failing, and logs a warning', async () => {
    const warnLog = memoryLogger('info');
    const broken = await createServices(loadEnv({ LLM_PROVIDER: 'mock', LOG_LEVEL: 'silent' }), {
      db,
      logger: warnLog.logger,
    });
    broken.runs = new BrokenRuns(db);

    const result = (await qualifyLead(lead, broken)).result;

    expect(await broken.leads.findById(result.leadId)).not.toBeNull();
    expect(warnLog.lines().find((l) => l.event === 'run.bookkeeping_failed')).toMatchObject({
      level: 40,
      leadId: result.leadId,
    });
    await broken.close();
  });
});
