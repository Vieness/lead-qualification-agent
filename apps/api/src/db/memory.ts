import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Db } from './client.js';
import { DEFAULT_PORTFOLIO_DIR, MIGRATIONS_DIR } from './paths.js';
import { loadPortfolio } from './portfolio-loader.js';
import { PortfolioRepository } from './repositories/index.js';
import * as schema from './schema.js';

/**
 * In-process Postgres (PGlite, WASM) with all migrations applied: real SQL semantics without
 * Docker. Used by tests, the CLI and the API when DATABASE_URL is not set. Data is lost when
 * the process exits.
 */
export async function createMemoryDb(
  options: { seed?: boolean; portfolioDir?: string } = {},
): Promise<{ db: Db; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  if (options.seed) {
    await new PortfolioRepository(db).upsertMany(
      await loadPortfolio(options.portfolioDir ?? DEFAULT_PORTFOLIO_DIR),
    );
  }
  return { db, close: () => client.close() };
}
