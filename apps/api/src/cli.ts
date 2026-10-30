import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { parseCliArgs } from './cli-args.js';
import { loadEnv, type Env } from './config/env.js';
import { LeadInputSchema } from './contracts/index.js';
import { errorMessage } from './error-message.js';
import { countEvents, createLogger } from './observability/index.js';
import { qualifyLead, type QualifyRun } from './qualify.js';
import { createServices, type ServiceOverrides } from './services.js';

const USAGE = `Usage: pnpm agent <lead.json> [--json] [--db] [--verbose] [--trace-dir=<dir>]

  <lead.json>        a lead like data/samples/hot-lead.json
  --json             print the full QualificationResult as JSON
  --db               use DATABASE_URL instead of a throwaway in-memory database
  --verbose          log run events (JSON lines) to stderr
  --trace-dir=<dir>  also write the run trace to <dir>/<traceId>.json

Runs with the LLM provider from .env (LLM_PROVIDER=mock needs no API key).`;

type Output = { write: (text: string) => unknown };
/** `db` lets tests share one database across many CLI runs instead of building one per run. */
type CliIo = { env?: Env; out?: Output; err?: Output; db?: ServiceOverrides['db'] };

function runStats(
  durationMs: number,
  events: QualifyRun['events'],
  usage: QualifyRun['state']['usage'],
): string {
  const { llmCalls, llmRetries: retries } = countEvents(events);
  return [
    `${durationMs} ms`,
    `${llmCalls} LLM calls`,
    `${usage.inputTokens} in / ${usage.outputTokens} out tokens`,
    ...(retries ? [`${retries} retries`] : []),
  ].join(' · ');
}

/** Human-readable report: decision, score, findings, the plan and the tool timeline. */
export function formatReport({ result, state, durationMs, events }: QualifyRun): string {
  const lines = [
    `Decision   ${result.decision} (${result.status})`,
    `Score      ${result.score}/100, tier ${result.tier}`,
    `Summary    ${result.summary}`,
    `Trace      ${result.traceId}   Lead ${result.leadId}`,
    `Run        ${runStats(durationMs, events, state.usage)}`,
    '',
    'Score breakdown',
    ...result.scoreBreakdown.map(
      (b) => `  ${b.rule.padEnd(17)} ${`${b.points}/${b.max}`.padStart(5)}  ${b.reason}`,
    ),
    '',
    'Guardrails',
    ...(result.guardrails.findings.length
      ? result.guardrails.findings.map((f) => `  [${f.severity}] ${f.code}: ${f.message}`)
      : ['  no findings']),
    '',
    'Plan (supervisor)',
    ...state.routeLog.map(
      (r) => `  ${String(r.step + 1).padStart(2)}. ${r.next.padEnd(13)} ${r.reason}`,
    ),
    '',
    'Tool calls',
    ...state.toolCalls.map(
      (c) =>
        `  ${String(c.step + 1).padStart(2)}. ${c.agent.padEnd(10)} ${c.tool.padEnd(21)} ${`${c.latencyMs}ms`.padStart(7)}  ${c.error ? `ERROR ${c.error.split('\n')[0]}` : 'ok'}`,
    ),
    ...(state.errors.length ? ['', 'Notes', ...state.errors.map((e) => `  ${e}`)] : []),
  ];
  if (result.draftReply) {
    lines.push('', `Draft reply (${result.draftReply.language}): ${result.draftReply.subject}`, '');
    lines.push(...result.draftReply.body.split('\n').map((l) => `  ${l}`));
  }
  return `${lines.join('\n')}\n`;
}

/** Returns the process exit code: 0 ok, 1 runtime failure, 2 bad usage or input. */
export async function runCli(argv: string[], io: CliIo = {}): Promise<number> {
  const out = io.out ?? process.stdout;
  const err = io.err ?? process.stderr;
  const args = parseCliArgs(argv, {
    json: { type: 'boolean' },
    db: { type: 'boolean' },
    verbose: { type: 'boolean' },
    'trace-dir': { type: 'string' },
    help: { type: 'boolean' },
  });
  if (!args.ok) {
    err.write(`${args.error}\n\n${USAGE}\n`);
    return 2;
  }
  const { values: flags, positionals } = args;
  if (flags.help) {
    out.write(`${USAGE}\n`);
    return 0;
  }
  const [file, ...extra] = positionals;
  if (!file || extra.length) {
    err.write(`${file ? `Unexpected arguments: ${extra.join(' ')}\n\n` : ''}${USAGE}\n`);
    return 2;
  }

  // pnpm runs scripts inside apps/api; resolve paths against where the user typed the command
  const path = resolve(process.env.INIT_CWD ?? process.cwd(), file);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (e) {
    err.write(`Cannot read lead from ${path}: ${errorMessage(e)}\n`);
    return 2;
  }
  const lead = LeadInputSchema.safeParse(raw);
  if (!lead.success) {
    err.write(`Invalid lead in ${path}:\n${z.prettifyError(lead.error)}\n`);
    return 2;
  }

  const env = io.env ?? loadEnv();
  // Logs go to stderr so stdout stays a clean report (or valid JSON with --json)
  const logger = createLogger({
    level: flags.verbose ? 'info' : 'warn',
    destination: { write: (line: string) => err.write(line) },
  });
  const services = await createServices(env, {
    memory: !flags.db,
    logger,
    ...(io.db ? { db: io.db } : {}),
  });
  try {
    const traceDir = flags['trace-dir']
      ? resolve(process.env.INIT_CWD ?? process.cwd(), flags['trace-dir'])
      : undefined;
    const run = await qualifyLead(lead.data, services, traceDir ? { traceDir } : {});
    out.write(flags.json ? `${JSON.stringify(run.result, null, 2)}\n` : formatReport(run));
    return 0;
  } catch (e) {
    err.write(`Agent run failed: ${errorMessage(e)}\n`);
    return 1;
  } finally {
    await services.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runCli(process.argv.slice(2));
}
