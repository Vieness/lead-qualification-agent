import { z } from 'zod';
import {
  LeadInputSchema,
  QualificationResultSchema,
  RunStatusSchema,
  ToolCallRecordSchema,
} from '../contracts/index.js';

// The OpenAPI document is generated from the same Zod schemas the API validates with, so the
// documentation cannot drift from the code. Served at /openapi.json and rendered at /docs.

const ErrorSchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  requestId: z.string(),
});

const LeadRecordSchema = z.object({
  lead: LeadInputSchema,
  result: QualificationResultSchema,
  approvedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

const TraceSchema = z.object({
  run: z
    .record(z.string(), z.unknown())
    .describe('Run summary: status, plan (routeLog), findings, LLM events, usage, duration'),
  toolCalls: z.array(ToolCallRecordSchema),
});

const HealthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.enum(['ok', 'down']),
  storage: z.enum(['postgres', 'memory']),
  llmProvider: z.string(),
});

const toSchema = (schema: z.ZodType, io: 'input' | 'output' = 'output') => {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema, { io, unrepresentable: 'any' });
  return json;
};

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ 'application/json': { schema } });
const error = (description: string) => ({ description, content: json(ref('Error')) });
const uuidParam = (name: string) => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
});

export function buildOpenApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Lead Qualification Agent API',
      version: '0.1.0',
      description:
        'Qualifies inbound agency leads with a multi-agent workflow. Errors share one shape (Error). When API_KEY is set, every endpoint except /health and the docs needs the x-api-key header.',
    },
    components: {
      securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' } },
      schemas: {
        LeadInput: toSchema(LeadInputSchema, 'input'),
        QualificationResult: toSchema(QualificationResultSchema),
        LeadRecord: toSchema(LeadRecordSchema),
        Trace: toSchema(TraceSchema),
        Health: toSchema(HealthSchema),
        Error: toSchema(ErrorSchema),
      },
    },
    // Relative to the document, so "Try it out" hits the API directly or through the UI proxy
    servers: [{ url: '.' }],
    security: [{ apiKey: [] }],
    paths: {
      '/leads': {
        post: {
          summary: 'Qualify a lead',
          description:
            'Runs the agent synchronously and stores the result. The x-trace-id response header links to the trace.',
          requestBody: { required: true, content: json(ref('LeadInput')) },
          responses: {
            201: {
              description: 'Lead qualified and stored',
              content: json(ref('QualificationResult')),
            },
            400: error('Invalid lead; details lists every invalid field'),
            401: error('Missing or invalid API key'),
            413: error('Body larger than 64 KB'),
          },
        },
        get: {
          summary: 'List leads, newest first',
          parameters: [
            { name: 'status', in: 'query', schema: toSchema(RunStatusSchema) },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            },
          ],
          responses: {
            200: {
              description: 'Leads',
              content: json({
                type: 'object',
                properties: { items: { type: 'array', items: ref('LeadRecord') } },
              }),
            },
            400: error('Invalid query'),
          },
        },
      },
      '/leads/{id}': {
        get: {
          summary: 'Get one lead with its result',
          parameters: [uuidParam('id')],
          responses: {
            200: { description: 'Lead', content: json(ref('LeadRecord')) },
            400: error('Malformed id'),
            404: error('Unknown lead'),
          },
        },
      },
      '/leads/{id}/approve': {
        post: {
          summary: 'Approve a lead parked for human review',
          parameters: [uuidParam('id')],
          responses: {
            200: { description: 'Approved (status "approved")', content: json(ref('LeadRecord')) },
            404: error('Unknown lead'),
            409: error('Not waiting for approval (not_pending) or no draft to approve (no_draft)'),
          },
        },
      },
      '/runs/{traceId}/trace': {
        get: {
          summary: 'What the agent did: plan, tool calls, LLM calls, tokens, duration (PII masked)',
          parameters: [uuidParam('traceId')],
          responses: {
            200: { description: 'Trace', content: json(ref('Trace')) },
            404: error('Unknown run'),
          },
        },
      },
      '/health': {
        get: {
          summary: 'Database and LLM provider status',
          security: [],
          responses: {
            200: { description: 'Healthy', content: json(ref('Health')) },
            503: { description: 'Database down', content: json(ref('Health')) },
          },
        },
      },
    },
  };
}

const SWAGGER_UI = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14';

/** Swagger UI page for /docs; assets come from a pinned CDN version, the spec from /openapi.json. */
export const SWAGGER_UI_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Lead Qualification Agent API</title>
    <link rel="stylesheet" href="${SWAGGER_UI}/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${SWAGGER_UI}/swagger-ui-bundle.js"></script>
    <script>
      // Relative URL: works at :3000/docs and behind the UI proxy at :8080/api/docs
      window.ui = SwaggerUIBundle({ url: 'openapi.json', dom_id: '#swagger-ui' });
    </script>
  </body>
</html>
`;
