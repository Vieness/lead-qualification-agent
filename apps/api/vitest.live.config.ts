import { defineConfig } from 'vitest/config';

// Uses the real .env (no LLM_PROVIDER override) and generous timeouts for network calls.
export default defineConfig({
  test: {
    include: ['tests/live/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
});
