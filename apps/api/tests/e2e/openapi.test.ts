import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { createMemoryDb } from '../../src/db/memory.js';

let app: FastifyInstance;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  const memory = await createMemoryDb();
  closeDb = memory.close;
  app = await buildApp(
    loadEnv({ LLM_PROVIDER: 'mock', LOG_LEVEL: 'silent', API_KEY: 'k'.repeat(32) }),
    { db: memory.db },
  );
});
afterAll(async () => {
  await app.close();
  await closeDb();
});

type Spec = {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, { required?: string[] }> };
};

describe('OpenAPI', () => {
  it('is public and describes every API route that exists', async () => {
    const res = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json<Spec>();
    expect(spec.openapi).toBe('3.1.0');

    for (const [path, operations] of Object.entries(spec.paths)) {
      for (const method of Object.keys(operations)) {
        const url = path.replace(/\{(\w+)\}/g, ':$1');
        expect(app.hasRoute({ method: method.toUpperCase(), url }), `${method} ${path}`).toBe(true);
      }
    }
    expect(Object.keys(spec.paths).sort()).toEqual([
      '/health',
      '/leads',
      '/leads/{id}',
      '/leads/{id}/approve',
      '/runs/{traceId}/trace',
    ]);
  });

  it('derives schemas from the Zod contracts', async () => {
    const spec = (await app.inject({ method: 'GET', url: '/openapi.json' })).json<Spec>();
    expect(spec.components.schemas.LeadInput?.required).toEqual(['name', 'email', 'message']);
    expect(spec.components.schemas.QualificationResult?.required).toContain('decision');
  });

  it('serves Swagger UI without the API key', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain("url: 'openapi.json'");
  });
});
