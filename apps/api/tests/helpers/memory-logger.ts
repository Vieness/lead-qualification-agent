import { createLogger, type Logger } from '../../src/observability/index.js';

/** A pino logger that keeps every line in memory, parsed, for assertions. */
export function memoryLogger(level: 'debug' | 'info' = 'debug'): {
  logger: Logger;
  lines: () => Array<Record<string, unknown>>;
  raw: () => string;
} {
  const chunks: string[] = [];
  const logger = createLogger({
    level,
    destination: { write: (line: string) => chunks.push(line) },
  });
  return {
    logger,
    lines: () => chunks.map((line) => JSON.parse(line) as Record<string, unknown>),
    raw: () => chunks.join(''),
  };
}
