export type FakeResponse = {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
};

export type CapturedRequest = {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
};

/**
 * A `fetch` replacement for running the real vendor SDKs offline: answers with queued canned
 * responses (the last one repeats) and records every request the SDK made.
 */
export function fakeFetch(...responses: FakeResponse[]) {
  const requests: CapturedRequest[] = [];
  const queue = [...responses];

  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input instanceof Request ? input.url : input),
      headers: new Headers(init?.headers),
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    });
    const next = (queue.length > 1 ? queue.shift() : queue[0]) ?? { status: 500, body: {} };
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json', ...next.headers },
    });
  }) as typeof fetch;

  return { fetch: fetchFn, requests };
}
