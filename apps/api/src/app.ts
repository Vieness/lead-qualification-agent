import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from 'fastify';
import type { Env } from './config/env.js';
import { registerApiKeyAuth } from './http/auth.js';
import { buildOpenApiDocument, SWAGGER_UI_HTML } from './http/openapi.js';
import { registerErrorHandlers } from './http/errors.js';
import { healthRoutes } from './routes/health.js';
import { leadsRoutes } from './routes/leads.js';
import { runsRoutes } from './routes/runs.js';
import { createServices, type ServiceOverrides } from './services.js';

/** Lead messages are capped at 5,000 characters; anything near this limit is not a lead. */
const BODY_LIMIT_BYTES = 64 * 1024;

export async function buildApp(
  env: Env,
  overrides: ServiceOverrides = {},
): Promise<FastifyInstance> {
  const services = await createServices(env, overrides);
  const app = Fastify<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    FastifyBaseLogger
  >({
    // One logger for HTTP and agent events, so every line has the same shape
    loggerInstance: services.logger,
    genReqId: () => crypto.randomUUID(),
    bodyLimit: BODY_LIMIT_BYTES,
  });
  app.addHook('onClose', () => services.close());
  if (services.storage === 'memory') {
    app.log.warn('DATABASE_URL is not set: using in-memory PGlite, data is lost on restart');
  }

  registerErrorHandlers(app);
  registerApiKeyAuth(app, env.API_KEY);
  const openApi = buildOpenApiDocument();
  app.get('/openapi.json', () => openApi);
  app.get('/docs', (_request, reply) => reply.type('text/html').send(SWAGGER_UI_HTML));
  await app.register(healthRoutes, { services });
  await app.register(leadsRoutes, { services });
  await app.register(runsRoutes, { services });

  return app;
}
