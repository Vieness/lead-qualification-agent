import type { Db } from '../../src/db/client.js';
import { createMemoryDb } from '../../src/db/memory.js';

/**
 * In-memory Postgres (PGlite, WASM) with all migrations applied. Real Postgres semantics
 * (FKs, enums, tsvector, transactions) without Docker, so tests run anywhere.
 */
export function createTestDb(): Promise<{ db: Db; close: () => Promise<void> }> {
  return createMemoryDb();
}
