/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Type-only imports of the API contracts (erased at build time), plus the Zod-free limits
    // file, the one piece of API code that ships to the browser. The more specific alias goes first.
    alias: {
      '@contracts/limits': fileURLToPath(
        new URL('../api/src/contracts/limits.ts', import.meta.url),
      ),
      '@contracts': fileURLToPath(new URL('../api/src/contracts/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // The UI calls /api/*; in dev Vite forwards it to Fastify, in Docker nginx does.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
  },
});
