import type { QualificationResult } from '../contracts/index.js';
import type { Expectation } from './expectations.js';

export type Observed = { result: QualificationResult; llmCalls: number };

const inRange = (value: number, range: { min?: number | undefined; max?: number | undefined }) =>
  (range.min === undefined || value >= range.min) &&
  (range.max === undefined || value <= range.max);

const describe = (range: { min?: number | undefined; max?: number | undefined }) =>
  `${range.min ?? '-∞'}..${range.max ?? '∞'}`;

/** Every way the observed run differs from the expectation; empty means the case passes. */
export function compare({ result, llmCalls }: Observed, expected: Expectation): string[] {
  const problems: string[] = [];
  const codes = new Set(result.guardrails.findings.map((f) => f.code));

  if (result.decision !== expected.decision) {
    problems.push(`decision ${result.decision}, expected ${expected.decision}`);
  }
  if (result.status !== expected.status) {
    problems.push(`status ${result.status}, expected ${expected.status}`);
  }
  if (expected.tier && !expected.tier.includes(result.tier)) {
    problems.push(`tier ${result.tier}, expected ${expected.tier.join(' or ')}`);
  }
  if (expected.score && !inRange(result.score, expected.score)) {
    problems.push(`score ${result.score}, expected ${describe(expected.score)}`);
  }
  for (const [rule, range] of Object.entries(expected.scoreRules ?? {})) {
    const item = result.scoreBreakdown.find((b) => b.rule === rule);
    if (!item) problems.push(`rule ${rule} missing from breakdown`);
    else if (!inRange(item.points, range)) {
      problems.push(`${rule} ${item.points} points, expected ${describe(range)}`);
    }
  }
  for (const code of expected.findingsInclude ?? []) {
    if (!codes.has(code)) problems.push(`missing finding ${code}`);
  }
  for (const code of expected.findingsExclude ?? []) {
    if (codes.has(code)) problems.push(`unexpected finding ${code}`);
  }
  if (
    expected.injectionDetected !== undefined &&
    result.guardrails.injectionDetected !== expected.injectionDetected
  ) {
    problems.push(`injectionDetected ${result.guardrails.injectionDetected}`);
  }
  if (expected.replyLanguage !== undefined) {
    const language = result.draftReply?.language ?? null;
    if (language !== expected.replyLanguage) {
      problems.push(`reply language ${language}, expected ${expected.replyLanguage}`);
    }
  }
  if (
    expected.minMatchedCases !== undefined &&
    result.matchedCases.length < expected.minMatchedCases
  ) {
    problems.push(
      `${result.matchedCases.length} matched cases, expected ≥ ${expected.minMatchedCases}`,
    );
  }
  if (expected.maxLlmCalls !== undefined && llmCalls > expected.maxLlmCalls) {
    problems.push(`${llmCalls} LLM calls, expected ≤ ${expected.maxLlmCalls}`);
  }
  return problems;
}
