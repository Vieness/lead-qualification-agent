import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { loadEnv } from '../config/env.js';
import { createDb } from './client.js';
import { MIGRATIONS_DIR } from './paths.js';

// Runtime migrator: production images ship without drizzle-kit, so `pnpm db:migrate` and the
// Docker entrypoint both use drizzle-orm's built-in migrator.

const { DATABASE_URL } = loadEnv();
if (!DATABASE_URL) throw new Error('DATABASE_URL is required to run migrations');

const { db, close } = createDb(DATABASE_URL);
try {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  process.stdout.write('Migrations applied\n');
} finally {
  await close();
}
