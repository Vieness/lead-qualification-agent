import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Real-provider tests cost money and need keys: run them with `pnpm test:live`
    exclude: ['tests/live/**', '**/node_modules/**'],
    environment: 'node',
    env: { LLM_PROVIDER: 'mock', LOG_LEVEL: 'silent' },
    // e2e files boot PGlite (WASM Postgres); under CPU load the 5 s defaults were too tight
    testTimeout: 20_000,
    hookTimeout: 30_000,
    maxWorkers: '50%',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Entry points are exercised by e2e tests through their exported functions
      exclude: ['src/index.ts', 'src/db/migrate.ts', 'src/db/seed.ts'],
      reporter: ['text-summary', 'html'],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
