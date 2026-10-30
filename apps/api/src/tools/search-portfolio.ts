import {
  SearchPortfolioInputSchema,
  SearchPortfolioOutputSchema,
  type MatchedCase,
} from '../contracts/index.js';
import type { PortfolioSearchHit } from '../db/repositories/index.js';
import { defineTool } from './types.js';

/** Maps Postgres ts_rank (unbounded, ~0.05–0.7 here) to 0–1: rank/(rank+k). */
const RANK_HALF_POINT = 0.1;
/** Cases below this relevance are noise (a single shared word) and are dropped. */
export const MIN_RELEVANCE = 0.3;

export function relevance(rank: number): number {
  return Math.round((rank / (rank + RANK_HALF_POINT)) * 100) / 100;
}

function toMatchedCase({ rank, ...hit }: PortfolioSearchHit): MatchedCase {
  return { ...hit, relevance: relevance(rank) };
}

export const searchPortfolioTool = defineTool({
  name: 'search_portfolio',
  description:
    "Finds the agency's past projects similar to the lead. `query` should be short English keywords (project type, industry, features); `services` narrows results to cases with those services.",
  input: SearchPortfolioInputSchema,
  output: SearchPortfolioOutputSchema,
  async execute({ query, services, limit }, ctx) {
    let hits = await ctx.portfolio.search({ query, services, limit });
    // A narrow service filter should not hide an otherwise relevant case
    if (hits.length === 0 && services.length > 0) {
      hits = await ctx.portfolio.search({ query, services: [], limit });
    }
    const cases = hits.map(toMatchedCase).filter((c) => c.relevance >= MIN_RELEVANCE);
    return { data: { cases } };
  },
});
