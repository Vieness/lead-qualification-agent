import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { LeadInputSchema, RunStatusSchema } from '../contracts/index.js';
import { HttpError, parseOr400 } from '../http/errors.js';
import { qualifyLead } from '../qualify.js';
import type { Services } from '../services.js';

const IdParams = z.object({ id: z.uuid() });
const ListQuery = z.object({
  status: RunStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const leadsRoutes: FastifyPluginAsync<{ services: Services }> = async (
  app,
  { services },
) => {
  /** Qualifies a lead synchronously and returns the stored result. */
  app.post('/leads', async (request, reply) => {
    const lead = parseOr400(LeadInputSchema, request.body, 'lead');
    // A client that hangs up cancels pending LLM calls; the run still finishes and is saved
    const disconnected = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) disconnected.abort();
    });
    const { result } = await qualifyLead(lead, services, { signal: disconnected.signal });
    request.log.info(
      {
        event: 'http.lead_qualified',
        traceId: result.traceId,
        leadId: result.leadId,
        decision: result.decision,
        score: result.score,
      },
      'lead qualified',
    );
    return reply.status(201).header('x-trace-id', result.traceId).send(result);
  });

  app.get('/leads', async (request) => {
    const query = parseOr400(ListQuery, request.query, 'query');
    const items = await services.leads.list(query);
    return { items };
  });

  app.get('/leads/:id', async (request) => {
    const { id } = parseOr400(IdParams, request.params, 'lead id');
    const lead = await services.leads.findById(id);
    if (!lead) throw new HttpError(404, 'not_found', `Lead ${id} not found`);
    return lead;
  });

  /** Human approval of a lead the agent parked for review. */
  app.post('/leads/:id/approve', async (request) => {
    const { id } = parseOr400(IdParams, request.params, 'lead id');
    const approval = await services.leads.markApproved(id);
    switch (approval.status) {
      case 'not_found':
        throw new HttpError(404, 'not_found', `Lead ${id} not found`);
      case 'not_pending':
        throw new HttpError(
          409,
          'not_pending',
          `Lead is "${approval.current}", not waiting for approval`,
        );
      case 'no_draft':
        throw new HttpError(
          409,
          'no_draft',
          'The agent wrote no draft for this lead; reply manually',
        );
      case 'approved':
        request.log.info({ event: 'http.lead_approved', leadId: id }, 'lead approved');
        return approval.lead;
    }
  });
};
