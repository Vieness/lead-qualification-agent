import { z } from 'zod';

export const DecisionSchema = z.enum(['auto_reply', 'human_review', 'reject']);
export type Decision = z.infer<typeof DecisionSchema>;

export const TierSchema = z.enum(['hot', 'warm', 'cold', 'spam']);
export type Tier = z.infer<typeof TierSchema>;

// `approved`: a person approved a lead the agent had parked for review
export const RunStatusSchema = z.enum([
  'completed',
  'pending_approval',
  'approved',
  'rejected',
  'failed',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const ServiceSchema = z.enum([
  'web',
  'mobile',
  'design',
  'branding',
  'marketing',
  'ai_automation',
  'other',
]);
export type Service = z.infer<typeof ServiceSchema>;

export const AgentNameSchema = z.enum(['supervisor', 'research', 'matching', 'writer']);
export type AgentName = z.infer<typeof AgentNameSchema>;

/** ISO 639-1 code of the language the lead is written in, e.g. "en", "uk", "de". */
export const LanguageSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2}$/, 'Expected a two-letter ISO 639-1 language code');
export type Language = z.infer<typeof LanguageSchema>;

/** Languages the writer agent drafts replies in; other languages fall back to English. */
export const ReplyLanguageSchema = z.enum(['en', 'uk']);
export type ReplyLanguage = z.infer<typeof ReplyLanguageSchema>;
