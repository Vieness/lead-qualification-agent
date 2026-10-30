import { sql, type SQL } from 'drizzle-orm';
import {
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  AgentNameSchema,
  DecisionSchema,
  RunStatusSchema,
  ServiceSchema,
  TierSchema,
  ToolNameSchema,
  type GuardFinding,
  type QualificationOutcome,
  type RouteStep,
  type TraceEvent,
} from '../contracts/index.js';

/** pg enums reuse the Zod enum values, so contracts stay the single source of truth. */
function enumValues<T extends string>(schema: { options: readonly T[] }): [T, ...T[]] {
  const [first, ...rest] = schema.options;
  if (first === undefined) throw new Error('Enum schema has no values');
  return [first, ...rest];
}

export const runStatusEnum = pgEnum('run_status', enumValues(RunStatusSchema));
export const decisionEnum = pgEnum('decision', enumValues(DecisionSchema));
export const tierEnum = pgEnum('tier', enumValues(TierSchema));
export const serviceEnum = pgEnum('service', enumValues(ServiceSchema));
export const agentNameEnum = pgEnum('agent_name', enumValues(AgentNameSchema));
export const toolNameEnum = pgEnum('tool_name', enumValues(ToolNameSchema));
export const leadSourceEnum = pgEnum('lead_source', ['web_form', 'email']);

const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** The "CRM": one row per qualified lead. Key fields are columns for filtering; the full agent output is in `outcome`. */
export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    company: text('company'),
    website: text('website'),
    message: text('message').notNull(),
    source: leadSourceEnum('source').notNull(),
    status: runStatusEnum('status').notNull(),
    decision: decisionEnum('decision').notNull(),
    tier: tierEnum('tier').notNull(),
    score: integer('score').notNull(),
    outcome: jsonb('outcome').$type<QualificationOutcome>().notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('leads_status_created_idx').on(t.status, t.createdAt),
    index('leads_email_idx').on(t.email),
  ],
);

/** One agent run; `id` is the run's traceId. `status` is null while the run is in progress. */
export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').primaryKey(),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  status: runStatusEnum('status'),
  llmProvider: text('llm_provider').notNull(),
  model: text('model'),
  promptVersions: jsonb('prompt_versions').$type<Record<string, string>>().notNull().default({}),
  steps: integer('steps').notNull().default(0),
  retries: integer('retries').notNull().default(0),
  findings: jsonb('findings').$type<GuardFinding[]>().notNull().default([]),
  /** Supervisor decisions in order: the executed plan. */
  routeLog: jsonb('route_log').$type<RouteStep[]>().notNull().default([]),
  /** Non-fatal events, e.g. a fallback search after the model failed. */
  notes: jsonb('notes').$type<string[]>().notNull().default([]),
  usage: jsonb('usage')
    .$type<{ inputTokens: number; outputTokens: number }>()
    .notNull()
    .default({ inputTokens: 0, outputTokens: 0 }),
  durationMs: integer('duration_ms'),
  /** LLM calls and retries in order (see TraceEvent). */
  events: jsonb('events').$type<TraceEvent[]>().notNull().default([]),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export const toolCalls = pgTable(
  'tool_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    step: integer('step').notNull(),
    agent: agentNameEnum('agent').notNull(),
    tool: toolNameEnum('tool').notNull(),
    args: jsonb('args').notNull(),
    result: jsonb('result'),
    error: text('error'),
    latencyMs: integer('latency_ms').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  },
  (t) => [unique('tool_calls_run_step_uq').on(t.runId, t.step)],
);

export const portfolioCases = pgTable(
  'portfolio_cases',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    services: serviceEnum('services').array().notNull(),
    industry: text('industry').notNull(),
    summary: text('summary').notNull(),
    body: text('body').notNull(),
    // Weighted full-text index: title matters most, then summary/industry, then the case body
    search: tsvector('search')
      .notNull()
      .generatedAlwaysAs(
        (): SQL => sql`
          setweight(to_tsvector('english', ${portfolioCases.title}), 'A') ||
          setweight(to_tsvector('english', ${portfolioCases.summary} || ' ' || ${portfolioCases.industry}), 'B') ||
          setweight(to_tsvector('english', ${portfolioCases.body}), 'C')`,
      ),
    updatedAt: timestamps.updatedAt,
  },
  (t) => [index('portfolio_cases_search_idx').using('gin', t.search)],
);
