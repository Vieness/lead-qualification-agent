import { z } from 'zod';
import { LLMError } from './errors.js';
import {
  addUsage,
  type LLMMessage,
  type LLMProvider,
  type LLMRequest,
  type TokenUsage,
} from './types.js';
import { errorMessage } from '../error-message.js';

export type StructuredRequest<S extends z.ZodType> = Omit<LLMRequest, 'output' | 'tools'> & {
  output: { name: string; schema: S };
};

export type StructuredResult<T> = {
  data: T;
  /** Extra attempts caused by invalid output (0 = valid on the first try). */
  retries: number;
  usage: TokenUsage;
  model: string | null;
};

/**
 * Asks for JSON matching `schema` and validates it with Zod. On invalid output the model gets
 * its answer back with the exact validation errors and one more chance, up to `maxRetries`
 * times. Refusals are not retried. Network-level retries happen below, in ResilientProvider.
 */
export async function generateStructured<S extends z.ZodType>(
  provider: LLMProvider,
  request: StructuredRequest<S>,
  { maxRetries }: { maxRetries: number },
): Promise<StructuredResult<z.infer<S>>> {
  const messages: LLMMessage[] = [...request.messages];
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let lastProblem = '';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // A snapshot: the history keeps growing after this call
    const result = await provider.complete({ ...request, messages: [...messages] });
    usage = addUsage(usage, result.usage);

    if (result.stopReason === 'refusal') {
      throw new LLMError('refusal', `Model declined "${request.purpose}"`);
    }

    const parsed = parseJson(result.text);
    if (result.stopReason === 'max_tokens') {
      lastProblem = 'The response was cut off by the token limit. Return a shorter JSON object.';
    } else if (!parsed.ok) {
      lastProblem = `The response was not valid JSON: ${parsed.error}`;
    } else {
      const validated = request.output.schema.safeParse(parsed.value);
      if (validated.success) {
        return { data: validated.data, retries: attempt, usage, model: result.model };
      }
      lastProblem = `The JSON did not match the required schema:\n${z.prettifyError(validated.error)}`;
    }

    messages.push(
      { role: 'assistant', content: result.text ?? '', raw: result.raw },
      {
        role: 'user',
        content: `${lastProblem}\nReturn only the corrected JSON object for "${request.output.name}".`,
      },
    );
  }

  throw new LLMError(
    'invalid_output',
    `No valid "${request.output.name}" after ${maxRetries + 1} attempts. ${lastProblem}`,
  );
}

/** Some OpenAI-compatible models wrap JSON in ```json fences even in JSON mode. */
function parseJson(
  text: string | null,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!text) return { ok: false, error: 'empty response' };
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return { ok: true, value: JSON.parse(unfenced) };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
