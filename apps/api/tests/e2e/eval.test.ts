import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { loadDataset } from '../../src/eval/dataset.js';
import { runEvalCli } from '../../src/eval/cli.js';
import { runEval, selectCases } from '../../src/eval/run.js';
import { LLMError, type LLMProvider } from '../../src/llm/index.js';

const env = loadEnv({ LLM_PROVIDER: 'mock', LOG_LEVEL: 'silent' });

/** A provider whose daily quota is gone: every call fails the same way. */
const exhausted: LLMProvider = {
  name: 'openai-compatible',
  model: 'quota-test',
  complete: () => Promise.reject(new LLMError('quota_exhausted', '429 tokens per day')),
};

describe('eval runner', () => {
  let outDir: string;
  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'eval-'));
  });
  afterAll(() => rm(outDir, { recursive: true, force: true }));

  it('stops when the provider quota runs out instead of scoring the outage', async () => {
    const run = await runEval({ env, outDir, minPass: 0, llm: exhausted });

    expect(run.ok).toBe(false);
    expect(run.incomplete).toMatch(
      /^provider quota exhausted at `.+` \(round 1\) after \d+ case runs$/,
    );
    // Only leads the input guard settles without the model were scored before the stop
    expect(run.results.length).toBeLessThan(5);
    const report = await readFile(join(outDir, 'eval.md'), 'utf8');
    expect(report).toContain('> **Incomplete:** provider quota exhausted');
  });

  it('runs only the selected cases, in dataset order, with token totals', async () => {
    const run = await runEval({
      env,
      outDir,
      minPass: 1,
      repeat: 2,
      cases: ['spam', 'hot-lead'],
    });

    expect(run.ok).toBe(true);
    expect(run.results.map((r) => `${r.id}#${r.run}`)).toEqual([
      'hot-lead#1',
      'spam#1',
      'hot-lead#2',
      'spam#2',
    ]);
    const used = run.results.reduce((a, r) => a + r.tokens.inputTokens, 0);
    expect(run.metrics.totalInputTokens).toBe(used);
    expect(used).toBeGreaterThan(0);
  });

  it('stops once the token budget is spent and says so', async () => {
    const run = await runEval({
      env,
      outDir,
      minPass: 0,
      cases: ['hot-lead', 'asap'],
      maxTokens: 1,
    });

    expect(run.ok).toBe(false);
    expect(run.results).toHaveLength(1);
    expect(run.incomplete).toMatch(/^token budget of 1 reached \(\d+ used\) after 1 case runs$/);
  });

  it('does not call a finished eval incomplete when the last run crosses the budget', async () => {
    const run = await runEval({ env, outDir, minPass: 1, cases: ['hot-lead'], maxTokens: 1 });
    expect(run).toMatchObject({ ok: true, incomplete: null });
  });

  it('rejects unknown case ids instead of running nothing', async () => {
    const cases = await loadDataset();
    expect(() => selectCases(cases, ['hot-lead', 'hot_lead'])).toThrow(
      /Unknown case ids: hot_lead/,
    );
    expect(selectCases(cases, undefined)).toBe(cases);
  });

  describe('command line', () => {
    function capture() {
      const chunks: string[] = [];
      return { write: (text: string) => chunks.push(text), text: () => chunks.join('') };
    }
    async function evalCli(...argv: string[]) {
      const out = capture();
      const err = capture();
      const code = await runEvalCli(argv, { env, out, err });
      return { code, out: out.text(), err: err.text() };
    }

    it.each([
      ['a mistyped flag', ['--repat=3'], /Unknown option '--repat'/],
      ['a repeat that is not a whole number', ['--repeat=two'], /--repeat must be a whole number/],
      ['a pass rate above 1', ['--min-pass=95'], /--min-pass must be a number between 0 and 1/],
      ['an unknown provider', ['--provider=groq'], /--provider must be "mock" or "env"/],
      ['an unknown case', ['--cases=hot_lead'], /Unknown case ids: hot_lead/],
      ['a stray argument', ['reports'], /Unexpected arguments: reports/],
    ])('exits with code 2 for %s before running anything', async (_case, args, message) => {
      const { code, out, err } = await evalCli(...args);
      expect(code).toBe(2);
      expect(out).toBe('');
      expect(err).toMatch(message);
    });

    it('runs the selected cases and prints a summary', async () => {
      const { code, out } = await evalCli(`--out=${outDir}`, '--cases=spam', '--repeat=2');
      expect(code).toBe(0);
      expect(out).toMatch(/^✅ spam 2\/2$/m);
      expect(out).toMatch(/2\/2 passed · 1\/1 cases pass every run/);
      expect(out).toMatch(/^Tokens \d+ in \/ \d+ out$/m);
    });
  });
});
