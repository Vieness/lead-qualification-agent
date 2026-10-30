import type { QualificationResult } from '../contracts/index.js';
import type { EvalCase } from './dataset.js';

export type CaseResult = {
  id: string;
  /** 1-based; with --repeat=N every case runs N times. */
  run: number;
  attack: boolean;
  description: string | undefined;
  passed: boolean;
  problems: string[];
  result: Pick<
    QualificationResult,
    'decision' | 'status' | 'tier' | 'score' | 'traceId' | 'summary'
  > & { injectionDetected: boolean; replyLanguage: string | null };
  expected: EvalCase['expected'];
  durationMs: number;
  llmCalls: number;
  tokens: { inputTokens: number; outputTokens: number };
};

export type Metrics = {
  /** Distinct cases; every rate below is over all runs of all cases. */
  cases: number;
  runs: number;
  passed: number;
  passRate: number;
  /** Cases that passed in every run: real models are not deterministic. */
  stableCases: number;
  decisionAccuracy: number;
  tierAccuracy: number | null;
  scoreInRange: number | null;
  attackDetection: number | null;
  falsePositiveRate: number | null;
  avgDurationMs: number;
  avgLlmCalls: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
};

const ratio = (hits: number, total: number) => (total === 0 ? null : hits / total);
const avg = (values: number[]) =>
  values.length === 0 ? 0 : Math.round(values.reduce((a, b) => a + b, 0) / values.length);

export type CaseStability = {
  id: string;
  passed: number;
  runs: number;
  /** Distinct problems across the failed runs. */
  problems: string[];
};

/** One row per case, in dataset order: how many of its runs passed. */
export function caseStability(results: CaseResult[]): CaseStability[] {
  const byId = new Map<string, CaseStability>();
  for (const r of results) {
    const row = byId.get(r.id) ?? { id: r.id, passed: 0, runs: 0, problems: [] };
    row.runs++;
    if (r.passed) row.passed++;
    for (const p of r.problems) if (!row.problems.includes(p)) row.problems.push(p);
    byId.set(r.id, row);
  }
  return [...byId.values()];
}

export function computeMetrics(results: CaseResult[]): Metrics {
  const stability = caseStability(results);
  const withTier = results.filter((r) => r.expected.tier);
  const withScore = results.filter((r) => r.expected.score);
  const attacks = results.filter((r) => r.attack);
  const benign = results.filter((r) => !r.attack);
  const inRange = (r: CaseResult) =>
    (r.expected.score?.min ?? -Infinity) <= r.result.score &&
    r.result.score <= (r.expected.score?.max ?? Infinity);
  const passed = results.filter((r) => r.passed).length;

  return {
    cases: stability.length,
    runs: Math.max(0, ...results.map((r) => r.run)),
    passed,
    passRate: ratio(passed, results.length) ?? 0,
    stableCases: stability.filter((c) => c.passed === c.runs).length,
    decisionAccuracy:
      ratio(
        results.filter((r) => r.result.decision === r.expected.decision).length,
        results.length,
      ) ?? 0,
    tierAccuracy: ratio(
      withTier.filter((r) => r.expected.tier?.includes(r.result.tier)).length,
      withTier.length,
    ),
    scoreInRange: ratio(withScore.filter(inRange).length, withScore.length),
    attackDetection: ratio(
      attacks.filter((r) => r.result.injectionDetected).length,
      attacks.length,
    ),
    falsePositiveRate: ratio(
      benign.filter((r) => r.result.injectionDetected).length,
      benign.length,
    ),
    avgDurationMs: avg(results.map((r) => r.durationMs)),
    avgLlmCalls:
      Math.round((results.reduce((a, r) => a + r.llmCalls, 0) / (results.length || 1)) * 10) / 10,
    avgInputTokens: avg(results.map((r) => r.tokens.inputTokens)),
    avgOutputTokens: avg(results.map((r) => r.tokens.outputTokens)),
    totalInputTokens: results.reduce((a, r) => a + r.tokens.inputTokens, 0),
    totalOutputTokens: results.reduce((a, r) => a + r.tokens.outputTokens, 0),
  };
}

const pct = (value: number | null) =>
  value === null ? 'n/a' : `${Math.round(value * 1000) / 10}%`;

export function renderMarkdown(
  metrics: Metrics,
  results: CaseResult[],
  meta: { provider: string; model: string | null; date: string; incomplete?: string | null },
): string {
  const repeated = metrics.runs > 1;
  const rows = results.map((r) => {
    const status = r.passed ? '✅' : '❌';
    const notes = r.passed ? (r.description ?? '') : r.problems.join('; ');
    return `| ${status} | \`${r.id}\`${repeated ? ` #${r.run}` : ''} | ${r.result.decision} | ${r.result.tier} | ${r.result.score} | ${r.result.injectionDetected ? 'yes' : 'no'} | ${r.llmCalls} | ${r.durationMs} | ${notes.replace(/\|/g, '\\|')} |`;
  });

  return [
    '# Eval report',
    '',
    `Provider **${meta.provider}**${meta.model ? ` (${meta.model})` : ''} · ${meta.date} · ${metrics.cases} cases from \`data/samples\` checked against \`data/expected\`.`,
    '',
    ...(meta.incomplete
      ? [`> **Incomplete:** ${meta.incomplete}. These numbers cover only the runs before it.`, '']
      : []),
    '## Metrics',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    ...(repeated
      ? [
          `| Runs per case | ${metrics.runs} |`,
          `| Case runs passed | ${metrics.passed}/${results.length} (${pct(metrics.passRate)}) |`,
          `| Cases passing every run | ${metrics.stableCases}/${metrics.cases} |`,
        ]
      : [`| Cases passed | ${metrics.passed}/${metrics.cases} (${pct(metrics.passRate)}) |`]),
    `| Decision accuracy | ${pct(metrics.decisionAccuracy)} |`,
    `| Tier accuracy | ${pct(metrics.tierAccuracy)} |`,
    `| Score within expected range | ${pct(metrics.scoreInRange)} |`,
    `| Prompt-injection detection (attacks) | ${pct(metrics.attackDetection)} |`,
    `| False injection alarms (normal leads) | ${pct(metrics.falsePositiveRate)} |`,
    `| Avg duration per lead | ${metrics.avgDurationMs} ms |`,
    `| Avg LLM calls per lead | ${metrics.avgLlmCalls} |`,
    `| Avg tokens per lead (in / out) | ${metrics.avgInputTokens} / ${metrics.avgOutputTokens} |`,
    `| Total tokens (in / out) | ${metrics.totalInputTokens} / ${metrics.totalOutputTokens} |`,
    '',
    ...(repeated ? renderStability(results) : []),
    '## Cases',
    '',
    '| | Case | Decision | Tier | Score | Injection | LLM calls | ms | Notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

function renderStability(results: CaseResult[]): string[] {
  return [
    '## Stability',
    '',
    '| | Case | Passed | Problems in failed runs |',
    '| --- | --- | --- | --- |',
    ...caseStability(results).map(
      (c) =>
        `| ${c.passed === c.runs ? '✅' : c.passed === 0 ? '❌' : '⚠️'} | \`${c.id}\` | ${c.passed}/${c.runs} | ${c.problems.join('; ').replace(/\|/g, '\\|')} |`,
    ),
    '',
  ];
}
