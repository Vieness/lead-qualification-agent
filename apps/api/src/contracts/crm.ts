import { z } from 'zod';
import { RunStatusSchema } from './common.js';
import { LeadInputSchema } from './lead.js';
import { QualificationOutcomeSchema } from './result.js';

// Kept apart from tools.ts: it depends on result.ts, which itself imports tool schemas.

export const SaveToCrmInputSchema = z.object({
  lead: LeadInputSchema,
  outcome: QualificationOutcomeSchema,
});
export type SaveToCrmInput = z.infer<typeof SaveToCrmInputSchema>;

export const SaveToCrmOutputSchema = z.object({
  leadId: z.uuid(),
  status: RunStatusSchema,
});
export type SaveToCrmOutput = z.infer<typeof SaveToCrmOutputSchema>;
