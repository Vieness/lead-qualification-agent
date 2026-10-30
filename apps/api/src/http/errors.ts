import type { FastifyError, FastifyInstance } from 'fastify';
import { type z } from 'zod';

export type ErrorBody = {
  error: string;
  message: string;
  details?: Array<{ path: string; message: string }>;
  requestId: string;
};

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: ErrorBody['details'],
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Validates request data; a failure becomes a 400 listing every invalid field. */
export function parseOr400<S extends z.ZodType>(
  schema: S,
  value: unknown,
  what: string,
): z.output<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  throw new HttpError(
    400,
    'invalid_input',
    `Invalid ${what}`,
    parsed.error.issues.map((issue) => ({
      path: issue.path.join('.') || '(root)',
      message: issue.message,
    })),
  );
}

/** One error shape for every endpoint; stack traces and internals never reach the client. */
export function registerErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | HttpError, request, reply) => {
    const body = (
      statusCode: number,
      error: string,
      message: string,
      details?: ErrorBody['details'],
    ) =>
      reply
        .status(statusCode)
        .send({ error, message, ...(details && { details }), requestId: request.id });

    if (err instanceof HttpError) return body(err.statusCode, err.code, err.message, err.details);
    if (err.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return body(413, 'payload_too_large', 'Request body is too large');
    }
    if (err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') {
      return body(415, 'unsupported_media_type', 'Send JSON with content-type application/json');
    }
    if (err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
      return body(400, 'empty_body', 'Body is empty; send JSON or omit the content-type header');
    }
    if (err.code === 'FST_ERR_CTP_INVALID_JSON_BODY' || err instanceof SyntaxError) {
      return body(400, 'invalid_json', 'Request body is not valid JSON');
    }
    // Any other client error from Fastify keeps its status instead of becoming a 500
    if (err.statusCode && err.statusCode < 500) {
      return body(err.statusCode, 'bad_request', err.message);
    }

    request.log.error({ err }, 'unhandled error');
    return body(
      500,
      'internal_error',
      'Something went wrong; quote the requestId when reporting it',
    );
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: 'not_found',
      message: `Route ${request.method} ${request.url} not found`,
      requestId: request.id,
    }),
  );
}
