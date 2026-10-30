import { z } from 'zod';
import { LEAD_MESSAGE_MAX, LEAD_MESSAGE_MIN } from './limits.js';

export { LEAD_MESSAGE_MAX, LEAD_MESSAGE_MIN };

const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** "https://www.Acme.io/about?x=1" → "acme.io": scheme, www., path, query and case removed. */
export function normalizeDomain(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '');
}

/** Accepts "acme.io", "https://www.acme.io/about" etc. and normalizes to a bare domain. */
export const WebsiteSchema = z
  .string()
  .trim()
  .max(2048)
  .transform(normalizeDomain)
  .pipe(z.string().max(253).regex(DOMAIN_PATTERN, 'Expected a website URL or domain'));

/** Body of POST /leads. Strict: unknown fields are rejected with 400. */
export const LeadInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  company: z.string().trim().min(1).max(200).optional(),
  website: WebsiteSchema.optional(),
  message: z.string().trim().min(LEAD_MESSAGE_MIN).max(LEAD_MESSAGE_MAX),
  source: z.enum(['web_form', 'email']).default('web_form'),
});

/** Lead after validation and normalization. */
export type LeadInput = z.infer<typeof LeadInputSchema>;
/** Raw request body before defaults and normalization. */
export type LeadInputRaw = z.input<typeof LeadInputSchema>;
