import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema.js';

/** Driver-agnostic database handle: postgres-js in the app, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export function createDb(
  databaseUrl: string,
  poolSize = 5,
): {
  db: PostgresJsDatabase<typeof schema>;
  close: () => Promise<void>;
} {
  // onnotice: skip informational NOTICEs ("already exists, skipping") that postgres.js prints by default
  const sql = postgres(databaseUrl, { max: poolSize, onnotice: () => {} });
  return { db: drizzle(sql, { schema }), close: () => sql.end() };
}
