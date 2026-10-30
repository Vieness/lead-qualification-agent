import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export type { Logger } from 'pino';

export type LoggerConfig = {
  level: LoggerOptions['level'];
  /** Human-readable output (pino-pretty, dev only). Ignored when a destination is given. */
  pretty?: boolean;
  /** Where to write JSON lines; stdout by default. Tests and the CLI pass their own. */
  destination?: DestinationStream;
};

/**
 * One pino logger shared by Fastify (HTTP logs) and the agent (run events), so every line has
 * the same JSON shape. Secrets in headers are redacted; PII never reaches the logger because
 * agent events carry metadata only and debug payloads are masked first.
 */
export function createLogger({ level, pretty, destination }: LoggerConfig): Logger {
  const options: LoggerOptions = {
    level,
    redact: {
      paths: ['req.headers["x-api-key"]', 'req.headers.authorization'],
      censor: '[redacted]',
    },
    ...(pretty && !destination && { transport: { target: 'pino-pretty' } }),
  };
  return destination ? pino(options, destination) : pino(options);
}
