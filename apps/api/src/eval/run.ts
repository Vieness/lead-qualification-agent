import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Env } from '../config/env.js';
import type { LLMProvider } from '../llm/index.js';
import { countEvents, createLogger, hitQuota } from '../observability/index.js';
import { qualifyLead } from '../qualify.js';
import { createServices } from '../services.js';
import { compare } from './compare.js';
import { loadDataset, type EvalCase } from './dataset.js';
import { computeMetrics, renderMarkdown, type CaseResult, type Metrics } from './report.js';

export type EvalOptions = {
  env: Env;
  outDir: string;
  minPass: number;
  repeat?: number;
  /** Case ids to run; all cases when omitted. */
  cases?: string[];
  /** Token budget (input + output) for the whole eval; stops after the run that crosses it. */
  maxTokens?: number;
  /** Test seam: a provider in place of the one env describes. */
  llm?: LLMProvider;
};

/** Runs every sample through the full pipeline and writes eval.md, eval.json and traces. */
export async function runEval({
  env,
  outDir,
  minPass,
  repeat = 1,
  cases: only,
  maxTokens,
  llm,
}: EvalOptions): Promise<{
  metrics: Metrics;
  results: CaseResult[];
  ok: boolean;
  /** Why the eval stopped early: a spent provider quota or the --max-tokens budget. */
  incomplete: string | null;
}> {
  const cases = selectCases(await loadDataset(), only);
  const traceDir = join(outDir, 'traces');
  const services = await createServices(env, {
    memory: true,
    logger: createLogger({ level: 'silent' }),
    ...(llm && { llm }),
  });

  const results: CaseResult[] = [];
  let incomplete: string | null = null;
  let tokensUsed = 0;
  try {
    // Whole rounds one after another: each round is a complete eval on its own
    rounds: for (let round = 1; round <= repeat; round++) {
      for (const c of cases) {
        const run = await qualifyLead(c.lead, services, { traceDir });
        tokensUsed += run.state.usage.inputTokens + run.state.usage.outputTokens;
        if (hitQuota(run.events)) {
          incomplete = `provider quota exhausted at \`${c.id}\` (round ${round}) after ${results.length} case runs`;
          break rounds;
        }
        const { llmCalls } = countEvents(run.events);
        const problems = compare({ result: run.result, llmCalls }, c.expected);
        const { result } = run;
        results.push({
          id: c.id,
          run: round,
          attack: c.attack,
          description: c.expected.description,
          passed: problems.length === 0,
          problems,
          result: {
            decision: result.decision,
            status: result.status,
            tier: result.tier,
            score: result.score,
            traceId: result.traceId,
            summary: result.summary,
            injectionDetected: result.guardrails.injectionDetected,
            replyLanguage: result.draftReply?.language ?? null,
          },
          expected: c.expected,
          durationMs: run.durationMs,
          llmCalls,
          tokens: run.state.usage,
        });
        const remaining = cases.length * repeat - results.length;
        if (maxTokens !== undefined && tokensUsed >= maxTokens && remaining > 0) {
          incomplete = `token budget of ${maxTokens} reached (${tokensUsed} used) after ${results.length} case runs`;
          break rounds;
        }
      }
    }
  } finally {
    await services.close();
  }

  const metrics = computeMetrics(results);
  const meta = {
    provider: services.llm.name,
    model: services.llm.model,
    date: new Date().toISOString(),
    incomplete,
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'eval.md'), renderMarkdown(metrics, results, meta));
  await writeFile(
    join(outDir, 'eval.json'),
    `${JSON.stringify({ meta, metrics, results }, null, 2)}\n`,
  );
  return { metrics, results, ok: !incomplete && metrics.passRate >= minPass, incomplete };
}

/** Keeps dataset order; an unknown id is a typo, so it fails loudly instead of running nothing. */
export function selectCases(cases: EvalCase[], ids: string[] | undefined): EvalCase[] {
  if (!ids?.length) return cases;
  const unknown = ids.filter((id) => !cases.some((c) => c.id === id));
  if (unknown.length) {
    throw new Error(
      `Unknown case ids: ${unknown.join(', ')}. Ids are paths under data/samples without .json`,
    );
  }
  return cases.filter((c) => ids.includes(c.id));
}
