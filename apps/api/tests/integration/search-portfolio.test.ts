import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PORTFOLIO_DIR } from '../../src/db/paths.js';
import { loadPortfolio } from '../../src/db/portfolio-loader.js';
import {
  MIN_RELEVANCE,
  relevance,
  runTool,
  searchPortfolioTool,
  type ToolContext,
} from '../../src/tools/index.js';
import { createToolContext } from '../helpers/tool-context.js';

let ctx: ToolContext;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ ctx, close } = await createToolContext());
  await ctx.portfolio.upsertMany(await loadPortfolio(DEFAULT_PORTFOLIO_DIR));
});
afterAll(() => close());

async function search(query: string, services: string[] = [], limit = 3) {
  const run = await runTool(searchPortfolioTool, { query, services, limit }, ctx);
  if (!run.ok) throw new Error(run.error);
  return run.result.cases;
}

describe('relevance', () => {
  it('maps ts_rank monotonically into 0–1', () => {
    expect(relevance(0)).toBe(0);
    expect(relevance(0.1)).toBe(0.5);
    expect(relevance(0.653)).toBe(0.87);
    expect(relevance(10)).toBeLessThan(1);
  });
});

describe('search_portfolio', () => {
  it('returns relevant cases above the threshold, best first', async () => {
    const cases = await search('loyalty mobile app');
    expect(cases[0]).toMatchObject({ id: 'loyalty-app-coffee-chain' });
    expect(cases.every((c) => c.relevance >= MIN_RELEVANCE && c.relevance <= 1)).toBe(true);
    const scores = cases.map((c) => c.relevance);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it('drops weak matches', async () => {
    expect(await search('zzz unrelated words')).toEqual([]);
  });

  it('relaxes the services filter when it hides every match', async () => {
    const cases = await search('loyalty mobile app', ['branding']);
    expect(cases[0]?.id).toBe('loyalty-app-coffee-chain');
  });

  it('rejects an out-of-range limit before touching the database', async () => {
    const run = await runTool(searchPortfolioTool, { query: 'app', services: [], limit: 50 }, ctx);
    expect(run).toMatchObject({ ok: false, errorKind: 'invalid_args' });
  });
});
