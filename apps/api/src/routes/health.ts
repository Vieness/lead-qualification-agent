import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import type { Services } from '../services.js';

export const healthRoutes: FastifyPluginAsync<{ services: Services }> = async (
  app,
  { services },
) => {
  app.get('/health', async (request, reply) => {
    let db: 'ok' | 'down' = 'ok';
    try {
      await services.db.execute(sql`select 1`);
    } catch (err) {
      request.log.warn({ err }, 'database health check failed');
      db = 'down';
    }
    return reply.status(db === 'ok' ? 200 : 503).send({
      status: db === 'ok' ? 'ok' : 'degraded',
      db,
      storage: services.storage,
      llmProvider: services.llm.name,
    });
  });
};
