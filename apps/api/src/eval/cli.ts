import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { intFlag, parseCliArgs, ratioFlag } from '../cli-args.js';
import { loadEnv, type Env } from '../config/env.js';
import { errorMessage } from '../error-message.js';
import { loadDataset } from './dataset.js';
import { caseStability, type Metrics } from './report.js';
import { runEval, selectCases } from './run.js';

const DEFAULT_OUT = fileURLToPath(new URL('../../../../reports', import.meta.url));

const USAGE = `Usage: pnpm eval [--provider=mock|env] [--out=<dir>] [--min-pass=<0..1>] [--repeat=<n>]
                 [--cases=<id,id>] [--max-tokens=<n>]

  --provider=mock   deterministic demo mock (default)
  --provider=env    the LLM_PROVIDER configured in .env (Claude, Groq, Ollama, ...)
  --out=<dir>       report directory (default: reports/)
  --min-pass=<n>    exit with code 1 below this pass rate (default 1 for mock, 0 for env)
  --repeat=<n>      run every case n times and report how stable each one is (default 1)
  --cases=<ids>     only these cases, e.g. --cases=hot-lead,attacks/spam-injection
  --max-tokens=<n>  stop once the runs have used n tokens (input + output)

Exit codes: 0 ok, 1 below --min-pass, 2 bad usage, 3 stopped early (provider quota or --max-tokens)
(pnpm reports every failure as 1; eval.json has "incomplete" set when the eval stopped early)`;

type Output = { write: (text: string) => unknown };

const percent = (value: number | null) => (value === null ? 'n/a' : `${Math.round(value * 100)}%`);

function summary(metrics: Metrics, runs: number, repeat: number): string {
  const stable =
    repeat > 1 ? ` · ${metrics.stableCases}/${metrics.cases} cases pass every run` : '';
  return (
    `${metrics.passed}/${runs} passed${stable} · decisions ${percent(metrics.decisionAccuracy)} · ` +
    `attacks caught ${percent(metrics.attackDetection)} · ` +
    `false alarms ${percent(metrics.falsePositiveRate)}\n` +
    `Tokens ${metrics.totalInputTokens} in / ${metrics.totalOutputTokens} out\n`
  );
}

/** `pnpm eval`: parses flags, runs the eval and prints one line per case. Returns the exit code. */
export async function runEvalCli(
  argv: string[],
  io: { env?: Env; out?: Output; err?: Output } = {},
): Promise<number> {
  const out = io.out ?? process.stdout;
  const err = io.err ?? process.stderr;
  const args = parseCliArgs(argv, {
    provider: { type: 'string', default: 'mock' },
    out: { type: 'string' },
    'min-pass': { type: 'string' },
    repeat: { type: 'string' },
    cases: { type: 'string' },
    'max-tokens': { type: 'string' },
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
  if (positionals.length) {
    err.write(`Unexpected arguments: ${positionals.join(' ')}\n\n${USAGE}\n`);
    return 2;
  }
  const { provider } = flags;
  if (provider !== 'mock' && provider !== 'env') {
    err.write(`--provider must be "mock" or "env", got "${provider}"\n\n${USAGE}\n`);
    return 2;
  }

  let options: {
    minPass: number;
    repeat: number;
    maxTokens: number | undefined;
    cases: string[] | undefined;
  };
  try {
    const cases = flags.cases?.split(',').filter(Boolean);
    selectCases(await loadDataset(), cases);
    options = {
      minPass: ratioFlag('min-pass', flags['min-pass']) ?? (provider === 'mock' ? 1 : 0),
      repeat: intFlag('repeat', flags.repeat, 1) ?? 1,
      maxTokens: intFlag('max-tokens', flags['max-tokens'], 1),
      cases,
    };
  } catch (e) {
    err.write(`${errorMessage(e)}\n`);
    return 2;
  }

  const base = io.env ?? loadEnv();
  const env = provider === 'mock' ? { ...base, LLM_PROVIDER: 'mock' as const } : base;
  const outDir = flags.out
    ? resolve(process.env.INIT_CWD ?? process.cwd(), flags.out)
    : DEFAULT_OUT;

  const { metrics, results, ok, incomplete } = await runEval({
    env,
    outDir,
    minPass: options.minPass,
    repeat: options.repeat,
    ...(options.cases && { cases: options.cases }),
    ...(options.maxTokens !== undefined && { maxTokens: options.maxTokens }),
  });
  for (const c of caseStability(results)) {
    const mark = c.passed === c.runs ? '✅' : c.passed === 0 ? '❌' : '⚠️';
    const count = options.repeat > 1 ? ` ${c.passed}/${c.runs}` : '';
    out.write(`${mark} ${c.id}${count}${c.problems.length ? `: ${c.problems.join('; ')}` : ''}\n`);
  }
  out.write(
    `\n${summary(metrics, results.length, options.repeat)}Report: ${join(outDir, 'eval.md')}\n`,
  );
  if (incomplete) {
    err.write(`\nIncomplete: ${incomplete}.\n`);
    return 3;
  }
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runEvalCli(process.argv.slice(2));
}
