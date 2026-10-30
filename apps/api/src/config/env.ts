import { z } from 'zod';

// Local runs read the repo-root .env; in Docker the variables come from compose.
try {
  process.loadEnvFile(new URL('../../../../.env', import.meta.url));
} catch {
  // no .env file — rely on the process environment
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url().optional(),
  /** When set, every endpoint except /health and the API docs requires the `x-api-key` header. */
  API_KEY: z.string().min(16).optional(),

  LLM_PROVIDER: z.enum(['mock', 'anthropic', 'openai-compatible']).default('mock'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  // Server-side refusal fallback to another Claude model (beta header)
  ANTHROPIC_FALLBACKS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  // Any OpenAI-compatible endpoint: Groq, OpenRouter, Gemini, Ollama. Empty = api.openai.com
  OPENAI_BASE_URL: z.string().url().optional(),
  // "auto" sends each call's effort as reasoning_effort (gpt-oss, o-series); models without
  // reasoning may reject the field, so it is off unless the model is known to support it
  OPENAI_REASONING_EFFORT: z.enum(['off', 'auto']).default('off'),
  // Folder with portfolio case studies for `make db-seed`; defaults to data/portfolio
  PORTFOLIO_DIR: z.string().optional(),
  // Write every run trace to <TRACE_DIR>/<traceId>.json (debugging; off when empty)
  TRACE_DIR: z.string().optional(),

  AGENT_MAX_STEPS: z.coerce.number().int().positive().default(12),
  AGENT_RUN_BUDGET_MS: z.coerce.number().int().positive().default(90_000),
  AGENT_MAX_SEARCH_TURNS: z.coerce.number().int().min(0).max(10).default(3),
  AGENT_MAX_REWRITES: z.coerce.number().int().min(0).max(5).default(1),
  DB_POOL_SIZE: z.coerce.number().int().positive().default(5),
  AGENT_LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  AGENT_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
  LLM_RETRY_BASE_MS: z.coerce.number().int().positive().default(500),
  LLM_RATE_LIMIT_RETRIES: z.coerce.number().int().min(0).default(5),
  LLM_MAX_CONCURRENCY: z.coerce.number().int().positive().default(4),
  LLM_MAX_RETRY_AFTER_MS: z.coerce.number().int().positive().default(30_000),
  HUMAN_APPROVAL_BUDGET_USD: z.coerce.number().positive().default(50_000),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  // Treat `KEY=` lines from .env as unset so defaults and optional checks apply
  const defined = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const parsed = EnvSchema.safeParse(defined);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  const env = parsed.data;
  if (env.LLM_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic');
  }
  if (env.LLM_PROVIDER === 'openai-compatible') {
    if (!env.OPENAI_MODEL) {
      throw new Error('OPENAI_MODEL is required when LLM_PROVIDER=openai-compatible');
    }
    // Local servers like Ollama accept any key; hosted OpenAI needs a real one
    if (!env.OPENAI_BASE_URL && !env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required when OPENAI_BASE_URL is not set');
    }
  }
  return env;
}
