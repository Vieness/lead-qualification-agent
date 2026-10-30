import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

/** Health and API docs stay public; everything that touches leads needs the key. */
const isOpen = (path: string) =>
  path === '/health' || path === '/openapi.json' || path === '/docs' || path.startsWith('/docs/');

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Optional shared-key protection for internal deployments. Off when API_KEY is not set so the
 * demo works out of the box; real deployments would put SSO / OAuth in front instead.
 */
export function registerApiKeyAuth(app: FastifyInstance, apiKey: string | undefined): void {
  if (!apiKey) return;
  app.addHook('onRequest', async (request, reply) => {
    if (isOpen(request.url.split('?')[0] ?? '')) return;
    const provided = request.headers['x-api-key'];
    if (typeof provided !== 'string' || !safeEqual(provided, apiKey)) {
      return reply.status(401).send({
        error: 'unauthorized',
        message: 'Missing or invalid x-api-key header',
        requestId: request.id,
      });
    }
  });
}
