import type {
  CompanyProfile,
  DraftReply,
  LeadInputRaw,
  MatchedCase,
  QualificationResult,
  Requirements,
  ScoreLeadOutput,
} from '../../src/contracts/index.js';

export const TRACE_ID = '7d3f0c1e-2b4a-4c5d-8e6f-1a2b3c4d5e6f';
export const LEAD_ID = '0f9e8d7c-6b5a-4f3e-9d2c-1b0a9f8e7d6c';

export const validLead: LeadInputRaw = {
  name: 'Olena',
  email: 'olena@acme.io',
  company: 'Acme',
  website: 'https://www.acme.io/about',
  message: 'We need a mobile app for our loyalty program, budget ~$30k, launch in Q2',
};

export const requirements: Requirements = {
  projectType: 'mobile_app',
  services: ['mobile', 'design'],
  budget: { min: 30000, max: 30000, currency: 'USD', raw: '~$30k' },
  timeline: { raw: 'launch in Q2', weeks: 16 },
  goals: ['Launch a loyalty program app'],
  missingInfo: [],
  language: 'en',
};

export const company: CompanyProfile = {
  name: 'Acme',
  domain: 'acme.io',
  industry: 'retail',
  size: '51-200',
  country: 'UA',
  description: 'Regional retail chain with 60 stores.',
  found: true,
  source: 'mock_enrichment',
};

export const matchedCase: MatchedCase = {
  id: 'case-loyalty-app',
  title: 'Loyalty app for a coffee chain',
  services: ['mobile', 'design'],
  industry: 'food_and_beverage',
  summary: 'iOS/Android loyalty app with QR rewards, 120k users in the first year.',
  relevance: 0.81,
};

/** Exactly what scoreLead() returns for `requirements` + `company` with one matched case. */
export const scoring: ScoreLeadOutput = {
  score: 95,
  tier: 'hot',
  breakdown: [
    { rule: 'budget_fit', points: 30, max: 30, reason: '$30k — $25k–$150k: ideal project size' },
    {
      rule: 'service_fit',
      points: 20,
      max: 25,
      reason: '2/2 requested services are core; 1 similar case(s)',
    },
    { rule: 'completeness', points: 15, max: 15, reason: 'Budget, timeline and scope given' },
    { rule: 'timeline_realism', points: 15, max: 15, reason: '16 weeks — 1–12 months: realistic' },
    { rule: 'company_signal', points: 15, max: 15, reason: 'Verified company, 51-200 employees' },
  ],
  tierCap: null,
};

export const draftReply: DraftReply = {
  language: 'en',
  subject: 'Your loyalty app project',
  body: 'Hi Olena, thanks for reaching out about your loyalty program app...',
};

export const qualificationResult: QualificationResult = {
  leadId: LEAD_ID,
  traceId: TRACE_ID,
  status: 'completed',
  decision: 'auto_reply',
  score: scoring.score,
  tier: scoring.tier,
  requirements,
  company,
  matchedCases: [matchedCase],
  scoreBreakdown: scoring.breakdown,
  tierCap: null,
  draftReply,
  guardrails: { injectionDetected: false, findings: [], retries: 0 },
  promptVersions: { research: '1.0.0', writer: '1.0.0' },
  summary: 'Hot lead: mobile loyalty app, $30k budget, 1 similar case. Auto-reply drafted.',
};
