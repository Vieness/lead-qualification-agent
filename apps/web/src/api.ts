import type {
  Health,
  LeadInputRaw,
  LeadRecord,
  QualificationResult,
  RunStatus,
  Trace,
} from './types';

export type FieldError = { path: string; message: string };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: FieldError[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type ErrorBody = { error?: string; message?: string; details?: FieldError[]; requestId?: string };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the API. Is it running?');
  }

  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const error = (body ?? {}) as ErrorBody;
    throw new ApiError(
      response.status,
      error.error ?? 'http_error',
      error.message ?? `Request failed with status ${response.status}`,
      error.details,
      error.requestId,
    );
  }
  return body as T;
}

export const api = {
  health: () => request<Health>('/health'),
  qualify: (lead: LeadInputRaw) =>
    request<QualificationResult>('/leads', { method: 'POST', body: JSON.stringify(lead) }),
  listLeads: (status?: RunStatus, limit = 50) =>
    request<{ items: LeadRecord[] }>(
      `/leads?${new URLSearchParams({ limit: String(limit), ...(status && { status }) })}`,
    ),
  getLead: (id: string) => request<LeadRecord>(`/leads/${id}`),
  approve: (id: string) => request<LeadRecord>(`/leads/${id}/approve`, { method: 'POST' }),
  getTrace: (traceId: string) => request<Trace>(`/runs/${traceId}/trace`),
};
