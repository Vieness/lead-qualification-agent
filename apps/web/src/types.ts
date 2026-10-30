// Response shapes of the API. Domain types come from the API's Zod contracts as type-only
// imports, so the UI and the server cannot drift apart and no validation code ships here.
import type {
  GuardFinding,
  LeadInput,
  LeadInputRaw,
  QualificationResult,
  RouteStep,
  RunStatus,
  ToolCallRecord,
  TraceEvent,
} from '@contracts';

export type {
  Decision,
  DraftReply,
  GuardFinding,
  LeadInputRaw,
  MatchedCase,
  QualificationResult,
  RunStatus,
  ScoreBreakdownItem,
  Tier,
} from '@contracts';

export type LeadRecord = {
  lead: LeadInput;
  result: QualificationResult;
  approvedAt: string | null;
  createdAt: string;
};

export type Trace = {
  run: {
    traceId: string;
    leadId: string | null;
    status: RunStatus | null;
    llmProvider: string;
    model: string | null;
    steps: number;
    retries: number;
    findings: GuardFinding[];
    routeLog: RouteStep[];
    notes: string[];
    usage: { inputTokens: number; outputTokens: number };
    durationMs: number | null;
    events: TraceEvent[];
    error: string | null;
    startedAt: string;
    finishedAt: string | null;
  };
  toolCalls: ToolCallRecord[];
};

export type Health = {
  status: 'ok' | 'degraded';
  db: 'ok' | 'down';
  storage: 'postgres' | 'memory';
  llmProvider: string;
};

export type LeadDraft = Required<Omit<LeadInputRaw, 'source'>>;
