export type LLMErrorKind =
  | 'timeout'
  | 'rate_limit'
  /** A 429 that waiting a few seconds will not fix: a daily quota or billing limit. */
  | 'quota_exhausted'
  | 'server'
  | 'network'
  | 'auth'
  | 'bad_request'
  | 'refusal'
  | 'max_tokens'
  | 'invalid_output'
  | 'aborted';

const RETRYABLE: ReadonlySet<LLMErrorKind> = new Set([
  'timeout',
  'rate_limit',
  'server',
  'network',
]);

/** Provider-neutral error: agents and the orchestrator only ever see this type. */
export class LLMError extends Error {
  readonly retryable: boolean;
  /** Provider-suggested wait from a `retry-after` header, if any. */
  readonly retryAfterMs: number | undefined;

  constructor(
    readonly kind: LLMErrorKind,
    message: string,
    options: { retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'LLMError';
    this.retryable = RETRYABLE.has(kind);
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** Classifies an HTTP error status the same way for every provider. */
export function kindFromStatus(status: number | undefined): LLMErrorKind {
  if (status === undefined) return 'network';
  if (status === 401 || status === 403) return 'auth';
  if (status === 408) return 'timeout';
  if (status === 409 || status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  return 'bad_request';
}

const QUOTA_MESSAGE = /per day|daily|quota/i;

/**
 * One classification for every provider's API errors. A 429 about a daily quota or billing
 * becomes `quota_exhausted`, which is not retried. When the header is missing, the wait is
 * read from the message ("Please try again in 1m38.9s", as Groq writes it).
 */
export function apiError(
  status: number | undefined,
  message: string,
  retryAfterHeader: string | null | undefined,
  cause: unknown,
): LLMError {
  const kind = kindFromStatus(status);
  const retryAfterMs = parseRetryAfter(retryAfterHeader) ?? retryAfterFromMessage(message);
  return new LLMError(
    kind === 'rate_limit' && QUOTA_MESSAGE.test(message) ? 'quota_exhausted' : kind,
    message,
    { cause, ...(retryAfterMs !== undefined && { retryAfterMs }) },
  );
}

/** Reads "try again in 1h2m3.5s" / "in 2.16s" from an error message. */
export function retryAfterFromMessage(message: string): number | undefined {
  const match = /try again in ((?:\d+(?:\.\d+)?[hms])+)/i.exec(message);
  if (!match?.[1]) return undefined;
  const unitMs: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1_000 };
  let total = 0;
  for (const [, value, unit] of match[1].matchAll(/(\d+(?:\.\d+)?)([hms])/gi)) {
    total += Number(value) * (unitMs[unit?.toLowerCase() ?? 's'] ?? 1_000);
  }
  return Math.round(total);
}

/** Parses a `retry-after` header given in seconds or as an HTTP date. */
export function parseRetryAfter(
  value: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** Plain-language reasons for failures that come from the provider, not from our own checks. */
const PROVIDER_FAILURES: Readonly<Record<string, string>> = {
  quota_exhausted: "the model provider's token quota is used up",
  rate_limit: 'the model provider is rate limiting requests',
  timeout: 'the model did not answer in time',
  server: 'the model provider returned an error',
  network: 'the model provider could not be reached',
  auth: 'the model provider rejected the API key',
  bad_request: 'the model provider rejected the request',
  refusal: 'the model declined the request',
  max_tokens: 'the answer was cut off by the token limit',
  aborted: 'the request was cancelled',
} satisfies Partial<Record<LLMErrorKind, string>>;

const waitText = (ms: number) =>
  ms < 60_000 ? `${Math.ceil(ms / 1000)} s` : `${Math.ceil(ms / 60_000)} min`;

/**
 * One short line for people (findings, notes): provider messages carry organisation ids, limits
 * and upsell links. The full message stays in the trace's tool calls and LLM events.
 * Returns null for failures whose own message is already the useful part (invalid output).
 */
export function describeLlmFailure(kind: string, message: string): string | null {
  const reason = PROVIDER_FAILURES[kind];
  if (!reason) return null;
  const wait =
    kind === 'quota_exhausted' || kind === 'rate_limit'
      ? retryAfterFromMessage(message)
      : undefined;
  return wait === undefined ? reason : `${reason}; try again in about ${waitText(wait)}`;
}
