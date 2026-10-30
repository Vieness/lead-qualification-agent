import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { errorMessage } from '../error-message.js';

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;

export class FrontmatterError extends Error {
  constructor(file: string, reason: string) {
    super(`${file}: ${reason}`);
    this.name = 'FrontmatterError';
  }
}

/**
 * Splits a markdown file into YAML frontmatter (validated with `schema`) and body.
 * Used for portfolio cases and versioned prompts.
 */
export function parseFrontmatter<S extends z.ZodType>(
  source: string,
  schema: S,
  file: string,
): { data: z.infer<S>; body: string } {
  const match = FRONTMATTER_PATTERN.exec(source);
  if (!match) {
    throw new FrontmatterError(file, 'missing frontmatter block delimited by ---');
  }
  const [, rawYaml = '', body = ''] = match;

  let yaml: unknown;
  try {
    yaml = parseYaml(rawYaml);
  } catch (err) {
    throw new FrontmatterError(file, `invalid YAML: ${errorMessage(err)}`);
  }

  const parsed = schema.safeParse(yaml);
  if (!parsed.success) {
    throw new FrontmatterError(file, `invalid frontmatter\n${z.prettifyError(parsed.error)}`);
  }
  return { data: parsed.data, body: body.trim() };
}
