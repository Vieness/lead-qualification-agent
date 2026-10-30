import { z } from 'zod';
import { LanguageSchema, ReplyLanguageSchema, ServiceSchema, TierSchema } from './common.js';
import { LEAD_MESSAGE_MAX } from './lead.js';

// Schemas filled by an LLM (tool arguments and structured output) use `.nullable()` rather than
// `.optional()`: providers' strict JSON modes require every property to be present. Plain
// `z.object` strips unknown keys instead of failing, so a chatty model does not burn a retry.

// --- extract_requirements ---------------------------------------------------------------------

export const ProjectTypeSchema = z.enum([
  'website',
  'web_app',
  'mobile_app',
  'ecommerce',
  'branding',
  'marketing_campaign',
  'ai_automation',
  'other',
]);
export type ProjectType = z.infer<typeof ProjectTypeSchema>;

/** Human-readable project types for summaries and replies. */
export const PROJECT_TYPE_LABELS: Record<ProjectType, { en: string; uk: string }> = {
  website: { en: 'website', uk: 'сайт' },
  web_app: { en: 'web app', uk: 'вебзастосунок' },
  mobile_app: { en: 'mobile app', uk: 'мобільний застосунок' },
  ecommerce: { en: 'e-commerce', uk: 'інтернет-магазин' },
  branding: { en: 'branding', uk: 'брендинг' },
  marketing_campaign: { en: 'marketing campaign', uk: 'маркетингова кампанія' },
  ai_automation: { en: 'AI automation', uk: 'AI-автоматизація' },
  other: { en: 'custom', uk: 'індивідуальний проєкт' },
};

export const CurrencySchema = z.enum(['USD', 'EUR', 'GBP', 'UAH']);
export type Currency = z.infer<typeof CurrencySchema>;

/** Budget as the client stated it; conversion to USD happens in deterministic scoring code. */
export const BudgetSchema = z
  .object({
    min: z.number().nonnegative().nullable(),
    max: z.number().nonnegative().nullable(),
    currency: CurrencySchema,
    raw: z.string().max(200),
  })
  .refine((b) => b.min !== null || b.max !== null, 'Budget needs at least min or max')
  .refine((b) => b.min === null || b.max === null || b.min <= b.max, 'Budget min exceeds max');
export type Budget = z.infer<typeof BudgetSchema>;

export const TimelineSchema = z.object({
  raw: z.string().max(200),
  weeks: z.number().int().positive().max(520).nullable(),
});
export type Timeline = z.infer<typeof TimelineSchema>;

export const MissingInfoSchema = z.enum(['budget', 'timeline', 'scope', 'company']);
export type MissingInfo = z.infer<typeof MissingInfoSchema>;

export const ExtractRequirementsInputSchema = z.object({
  message: z.string().min(1).max(LEAD_MESSAGE_MAX),
});
export type ExtractRequirementsInput = z.infer<typeof ExtractRequirementsInputSchema>;

export const RequirementsSchema = z.object({
  projectType: ProjectTypeSchema,
  services: z.array(ServiceSchema).max(ServiceSchema.options.length),
  budget: BudgetSchema.nullable(),
  timeline: TimelineSchema.nullable(),
  goals: z.array(z.string().max(200)).max(10),
  missingInfo: z.array(MissingInfoSchema),
  language: LanguageSchema,
});
export type Requirements = z.infer<typeof RequirementsSchema>;

// --- enrich_company ---------------------------------------------------------------------------

export const CompanySizeSchema = z.enum(['1-10', '11-50', '51-200', '201-1000', '1000+']);
export type CompanySize = z.infer<typeof CompanySizeSchema>;

export const EnrichCompanyInputSchema = z.object({
  company: z.string().max(200).nullable(),
  website: z.string().max(253).nullable(),
  emailDomain: z.string().min(1).max(253),
});
export type EnrichCompanyInput = z.infer<typeof EnrichCompanyInputSchema>;

export const CompanyProfileSchema = z.object({
  name: z.string().min(1).max(200),
  domain: z.string().max(253).nullable(),
  industry: z.string().max(100).nullable(),
  size: CompanySizeSchema.nullable(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  /** Free text from the enrichment source (e.g. the company's website). Untrusted input. */
  description: z.string().max(300).nullable(),
  found: z.boolean(),
  source: z.enum(['mock_enrichment', 'none']),
});
export type CompanyProfile = z.infer<typeof CompanyProfileSchema>;

// --- search_portfolio -------------------------------------------------------------------------

export const PORTFOLIO_LIMIT_MAX = 5;

export const SearchPortfolioInputSchema = z.object({
  query: z.string().min(1).max(500),
  services: z.array(ServiceSchema).max(ServiceSchema.options.length),
  limit: z.number().int().min(1).max(PORTFOLIO_LIMIT_MAX).default(3),
});
export type SearchPortfolioInput = z.infer<typeof SearchPortfolioInputSchema>;

export const MatchedCaseSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  services: z.array(ServiceSchema),
  industry: z.string().max(100),
  summary: z.string().max(500),
  relevance: z.number().min(0).max(1),
});
export type MatchedCase = z.infer<typeof MatchedCaseSchema>;

export const SearchPortfolioOutputSchema = z.object({
  cases: z.array(MatchedCaseSchema).max(PORTFOLIO_LIMIT_MAX),
});
export type SearchPortfolioOutput = z.infer<typeof SearchPortfolioOutputSchema>;

// --- score_lead (deterministic, no LLM) -------------------------------------------------------

export const ScoreRuleSchema = z.enum([
  'budget_fit',
  'service_fit',
  'completeness',
  'timeline_realism',
  'company_signal',
]);
export type ScoreRule = z.infer<typeof ScoreRuleSchema>;

export const ScoreLeadInputSchema = z.object({
  requirements: RequirementsSchema,
  company: CompanyProfileSchema,
  matchedCasesCount: z.number().int().min(0).max(PORTFOLIO_LIMIT_MAX),
});
export type ScoreLeadInput = z.infer<typeof ScoreLeadInputSchema>;

export const ScoreBreakdownItemSchema = z
  .object({
    rule: ScoreRuleSchema,
    points: z.number().int().nonnegative(),
    max: z.number().int().positive(),
    reason: z.string().min(1).max(300),
  })
  .refine((item) => item.points <= item.max, 'Points exceed the rule maximum');
export type ScoreBreakdownItem = z.infer<typeof ScoreBreakdownItemSchema>;

/** Set when a deal-breaker (budget below the minimum, impossible deadline) caps the tier at cold. */
export const TierCapSchema = z.object({
  tier: z.literal('cold'),
  reasons: z.array(z.string().min(1).max(300)).min(1),
});
export type TierCap = z.infer<typeof TierCapSchema>;

export const ScoreLeadOutputSchema = z.object({
  score: z.number().int().min(0).max(100),
  tier: TierSchema,
  breakdown: z.array(ScoreBreakdownItemSchema),
  tierCap: TierCapSchema.nullable(),
});
export type ScoreLeadOutput = z.infer<typeof ScoreLeadOutputSchema>;

// --- draft_reply ------------------------------------------------------------------------------

export const DraftReplyInputSchema = z.object({
  leadName: z.string().min(1).max(100),
  language: ReplyLanguageSchema,
  requirements: RequirementsSchema,
  matchedCases: z.array(MatchedCaseSchema).max(PORTFOLIO_LIMIT_MAX),
  tier: TierSchema,
  missingInfo: z.array(MissingInfoSchema),
  /** Policy violations of the previous draft; non-empty when the writer is asked to rewrite. */
  policyFeedback: z.array(z.string().max(500)).max(10).default([]),
});
export type DraftReplyInput = z.infer<typeof DraftReplyInputSchema>;

export const DraftReplySchema = z.object({
  language: ReplyLanguageSchema,
  subject: z.string().trim().min(1).max(150),
  body: z.string().trim().min(1).max(3000),
});
export type DraftReply = z.infer<typeof DraftReplySchema>;

// --- registry ---------------------------------------------------------------------------------

/**
 * Tools the agents can call. `save_to_crm` is not here: the graph calls it deterministically
 * after the guards, so the LLM can never decide to skip or repeat persistence (see crm.ts).
 */
export const agentToolSchemas = {
  extract_requirements: {
    input: ExtractRequirementsInputSchema,
    output: RequirementsSchema,
  },
  enrich_company: {
    input: EnrichCompanyInputSchema,
    output: CompanyProfileSchema,
  },
  search_portfolio: {
    input: SearchPortfolioInputSchema,
    output: SearchPortfolioOutputSchema,
  },
  score_lead: {
    input: ScoreLeadInputSchema,
    output: ScoreLeadOutputSchema,
  },
  draft_reply: {
    input: DraftReplyInputSchema,
    output: DraftReplySchema,
  },
} as const;

export type AgentToolName = keyof typeof agentToolSchemas;

export const ToolNameSchema = z.enum([
  'extract_requirements',
  'enrich_company',
  'search_portfolio',
  'score_lead',
  'draft_reply',
  'save_to_crm',
]);
export type ToolName = z.infer<typeof ToolNameSchema>;
