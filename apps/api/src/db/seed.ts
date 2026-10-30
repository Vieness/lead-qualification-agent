import { loadEnv } from '../config/env.js';
import { createDb } from './client.js';
import { DEFAULT_PORTFOLIO_DIR } from './paths.js';
import { loadPortfolio } from './portfolio-loader.js';
import { PortfolioRepository } from './repositories/index.js';

const { DATABASE_URL, PORTFOLIO_DIR } = loadEnv();
if (!DATABASE_URL) throw new Error('DATABASE_URL is required to seed the database');

const dir = PORTFOLIO_DIR ?? DEFAULT_PORTFOLIO_DIR;
const cases = await loadPortfolio(dir);

const { db, close } = createDb(DATABASE_URL);
try {
  const portfolio = new PortfolioRepository(db);
  await portfolio.upsertMany(cases);
  process.stdout.write(
    `Seeded ${cases.length} portfolio cases (total in DB: ${await portfolio.count()})\n`,
  );
} finally {
  await close();
}
