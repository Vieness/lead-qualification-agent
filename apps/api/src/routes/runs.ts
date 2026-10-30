import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { HttpError, parseOr400 } from '../http/errors.js';
import { traceView } from '../observability/index.js';
import type { Services } from '../services.js';

const TraceParams = z.object({ traceId: z.uuid() });

export const runsRoutes: FastifyPluginAsync<{ services: Services }> = async (app, { services }) => {
  /** What the agent did for one run: plan, tool calls, LLM calls and retries, tokens, duration. PII is masked. */
  app.get('/runs/:traceId/trace', async (request) => {
    const { traceId } = parseOr400(TraceParams, request.params, 'trace id');
    const trace = await services.runs.getTrace(traceId);
    if (!trace) throw new HttpError(404, 'not_found', `Run ${traceId} not found`);

    return traceView(trace);
  });
};
