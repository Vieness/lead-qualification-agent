import type { CompanySize, Service, Tier } from '../contracts/index.js';

// All business thresholds of lead scoring live here, so sales can review them in one place.

export const RULE_MAX = {
  budget_fit: 30,
  service_fit: 25,
  completeness: 15,
  timeline_realism: 15,
  company_signal: 15,
} as const;

/** Budget bands in USD, checked top-down: first band whose `min` is reached wins. */
export const BUDGET_BANDS: ReadonlyArray<{ min: number; points: number; label: string }> = [
  { min: 150_000, points: 25, label: 'above $150k: large, needs careful scoping' },
  { min: 25_000, points: 30, label: '$25k–$150k: ideal project size' },
  { min: 10_000, points: 20, label: '$10k–$25k: workable project size' },
  { min: 5_000, points: 10, label: '$5k–$10k: small project' },
  { min: 0, points: 0, label: 'below $5k: too small for a custom project' },
];
export const UNKNOWN_BUDGET_POINTS = 5;

/** Services the agency actually sells. */
export const CORE_SERVICES: ReadonlySet<Service> = new Set([
  'web',
  'mobile',
  'design',
  'branding',
  'marketing',
  'ai_automation',
]);
export const SERVICE_SHARE_POINTS = 15;
export const POINTS_PER_MATCHED_CASE = 5;
export const MAX_CASE_POINTS = 10;
export const NO_SERVICES_POINTS = 5;

export const COMPLETENESS_PENALTY = 5;

/** Timeline bands in weeks, checked top-down. */
export const TIMELINE_BANDS: ReadonlyArray<{ minWeeks: number; points: number; label: string }> = [
  { minWeeks: 53, points: 10, label: 'over a year: long horizon, priority may change' },
  { minWeeks: 4, points: 15, label: '1–12 months: realistic' },
  { minWeeks: 2, points: 7, label: '2–4 weeks: tight' },
  { minWeeks: 0, points: 0, label: 'under 2 weeks: unrealistic for a custom project' },
];
export const UNKNOWN_TIMELINE_POINTS = 7;

export const COMPANY_SIZE_POINTS: Record<CompanySize, number> = {
  '1-10': 5,
  '11-50': 10,
  '51-200': 15,
  '201-1000': 15,
  '1000+': 15,
};
export const UNVERIFIED_COMPANY_POINTS = 5;

export const TIER_THRESHOLDS: ReadonlyArray<{ min: number; tier: Exclude<Tier, 'spam'> }> = [
  { min: 70, tier: 'hot' },
  { min: 40, tier: 'warm' },
  { min: 0, tier: 'cold' },
];

/**
 * Viability gate: a deal-breaker caps the tier at cold, whatever the other rules add up to.
 * Without it a clearly written but unviable request ($500 app "by next week") scores as warm.
 */
export const MIN_VIABLE_BUDGET_USD = 5_000;
export const MIN_VIABLE_WEEKS = 2;
