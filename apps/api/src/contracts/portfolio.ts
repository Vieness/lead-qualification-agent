import { z } from 'zod';
import { ServiceSchema } from './common.js';

/** Frontmatter of a case study file in data/portfolio/*.md. */
export const PortfolioCaseMetaSchema = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Expected a kebab-case slug')
    .max(100),
  title: z.string().min(1).max(200),
  services: z.array(ServiceSchema).min(1),
  industry: z.string().min(1).max(100),
  summary: z.string().min(1).max(500),
});
export type PortfolioCaseMeta = z.infer<typeof PortfolioCaseMetaSchema>;

export const PortfolioCaseSchema = PortfolioCaseMetaSchema.extend({
  body: z.string().min(1),
});
export type PortfolioCase = z.infer<typeof PortfolioCaseSchema>;
