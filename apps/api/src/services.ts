import type { AgentConfig, AgentDeps } from './agents/index.js';
import type { Env } from './config/env.js';
import { createDb, type Db } from './db/client.js';
import { createMemoryDb } from './db/memory.js';
import { LeadRepository, PortfolioRepository, RunRepository } from './db/repositories/index.js';
import { createLLMProvider, type LLMProvider } from './llm/index.js';
import { createLogger, ObservedProvider, recordRetry, type Logger } from './observability/index.js';
import { FilePromptLoader } from './prompts/loader.js';
import { JsonCompanyDirectory, type CompanyDirectory, type ToolContext } from './tools/index.js';

export type Services = {
  db: Db;
  /** "memory" = PGlite without DATABASE_URL: data is lost on exit. */
  storage: 'postgres' | 'memory';
  /** Wrapped in ObservedProvider: every call lands in the current run's trace. */
  llm: LLMProvider;
  logger: Logger;
  /** When set, every run is also written to <traceDir>/<traceId>.json. */
  traceDir: string | undefined;
  leads: LeadRepository;
  runs: RunRepository;
  agent: AgentDeps;
  close: () => Promise<void>;
};

export type ServiceOverrides = {
  db?: Db;
  llm?: LLMProvider;
  companies?: CompanyDirectory;
  /** Test seam: e.g. a repository whose writes fail. */
  leads?: LeadRepository;
  logger?: Logger;
  /** Force in-memory storage even when DATABASE_URL is set (CLI default). */
  memory?: boolean;
};

/** Agent limits come from env only, so every entry point and test shares one set of defaults. */
export function agentConfigFromEnv(env: Env): AgentConfig {
  return {
    maxSteps: env.AGENT_MAX_STEPS,
    approvalThresholdUsd: env.HUMAN_APPROVAL_BUDGET_USD,
    maxSearchTurns: env.AGENT_MAX_SEARCH_TURNS,
    maxRewrites: env.AGENT_MAX_REWRITES,
    runBudgetMs: env.AGENT_RUN_BUDGET_MS,
  };
}

/** Composition root: the only place that turns env into concrete dependencies. */
export async function createServices(
  env: Env,
  overrides: ServiceOverrides = {},
): Promise<Services> {
  let db: Db;
  let close: () => Promise<void>;
  let storage: Services['storage'];
  if (overrides.db) {
    ({ db } = overrides);
    close = async () => {};
    storage = 'postgres';
  } else if (env.DATABASE_URL && !overrides.memory) {
    ({ db, close } = createDb(env.DATABASE_URL, env.DB_POOL_SIZE));
    storage = 'postgres';
  } else {
    ({ db, close } = await createMemoryDb({ seed: true }));
    storage = 'memory';
  }

  const logger =
    overrides.logger ??
    createLogger({ level: env.LOG_LEVEL, pretty: env.NODE_ENV === 'development' });
  const llm = new ObservedProvider(
    overrides.llm ?? createLLMProvider(env, { onRetry: recordRetry }),
  );
  const leads = overrides.leads ?? new LeadRepository(db);
  const tools: ToolContext = {
    llm,
    prompts: new FilePromptLoader(),
    portfolio: new PortfolioRepository(db),
    leads,
    companies: overrides.companies ?? new JsonCompanyDirectory(),
    maxRetries: env.AGENT_MAX_RETRIES,
  };

  return {
    db,
    storage,
    llm,
    logger,
    traceDir: env.TRACE_DIR,
    leads,
    runs: new RunRepository(db),
    agent: { tools, config: agentConfigFromEnv(env) },
    close,
  };
}
