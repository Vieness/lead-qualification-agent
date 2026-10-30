import { and, arrayOverlaps, count, sql } from 'drizzle-orm';
import type { PortfolioCase, Service } from '../../contracts/index.js';
import type { Db } from '../client.js';
import { portfolioCases } from '../schema.js';

const MAX_QUERY_TERMS = 20;

export type PortfolioSearchHit = Omit<PortfolioCase, 'body'> & {
  /** Raw Postgres ts_rank; the search_portfolio tool normalizes it to 0–1. */
  rank: number;
};

/**
 * Turns free text into an OR-query of words ("loyalty | mobile | app"). Only letters and digits
 * survive, so user or LLM text can never inject tsquery operators.
 */
export function toOrTsQuery(text: string): string {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const unique = [...new Set(words.filter((w) => w.length >= 2))];
  return unique.slice(0, MAX_QUERY_TERMS).join(' | ');
}

export class PortfolioRepository {
  constructor(private readonly db: Db) {}

  /** Idempotent: re-running the seed updates existing cases instead of duplicating them. */
  async upsertMany(cases: PortfolioCase[]): Promise<void> {
    if (cases.length === 0) return;
    await this.db
      .insert(portfolioCases)
      .values(cases)
      .onConflictDoUpdate({
        target: portfolioCases.id,
        set: {
          title: sql`excluded.title`,
          services: sql`excluded.services`,
          industry: sql`excluded.industry`,
          summary: sql`excluded.summary`,
          body: sql`excluded.body`,
          updatedAt: new Date(),
        },
      });
  }

  async count(): Promise<number> {
    const [row] = await this.db.select({ value: count() }).from(portfolioCases);
    return row?.value ?? 0;
  }

  /** Full-text search ranked by relevance; `services` (if any) must overlap the case's services. */
  async search(params: {
    query: string;
    services: Service[];
    limit: number;
  }): Promise<PortfolioSearchHit[]> {
    const tsquery = toOrTsQuery(params.query);
    if (!tsquery) return [];

    const query = sql`to_tsquery('english', ${tsquery})`;
    const rank = sql<number>`ts_rank(${portfolioCases.search}, ${query})`;

    return this.db
      .select({
        id: portfolioCases.id,
        title: portfolioCases.title,
        services: portfolioCases.services,
        industry: portfolioCases.industry,
        summary: portfolioCases.summary,
        rank: rank.mapWith(Number),
      })
      .from(portfolioCases)
      .where(
        and(
          sql`${portfolioCases.search} @@ ${query}`,
          params.services.length > 0
            ? arrayOverlaps(portfolioCases.services, params.services)
            : undefined,
        ),
      )
      .orderBy(sql`${rank} desc`, portfolioCases.id)
      .limit(params.limit);
  }
}
