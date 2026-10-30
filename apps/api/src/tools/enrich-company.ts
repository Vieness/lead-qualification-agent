import {
  CompanyProfileSchema,
  EnrichCompanyInputSchema,
  normalizeDomain,
  type CompanyProfile,
} from '../contracts/index.js';
import { defineTool } from './types.js';

/** Personal mailboxes say nothing about the company behind a lead. */
export const FREE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
  'gmx.com',
  'ukr.net',
  'i.ua',
  'meta.ua',
]);

const DESCRIPTION_MAX = 300;

export const enrichCompanyTool = defineTool({
  name: 'enrich_company',
  description:
    "Looks up the lead's company by website or email domain and returns industry, size and country. Personal email domains (gmail etc.) are not looked up.",
  input: EnrichCompanyInputSchema,
  output: CompanyProfileSchema,
  async execute({ company, website, emailDomain }, ctx) {
    const emailCandidate = normalizeDomain(emailDomain);
    const corporateEmail = FREE_EMAIL_DOMAINS.has(emailCandidate) ? null : emailCandidate;
    const candidates = [website ? normalizeDomain(website) : null, corporateEmail].filter(
      (d): d is string => Boolean(d),
    );

    for (const domain of new Set(candidates)) {
      const record = await ctx.companies.findByDomain(domain);
      if (record) {
        const profile: CompanyProfile = {
          name: record.name,
          domain: record.domain,
          industry: record.industry,
          size: record.size,
          country: record.country,
          description: record.description.slice(0, DESCRIPTION_MAX),
          found: true,
          source: 'mock_enrichment',
        };
        return { data: profile };
      }
    }

    const domain = candidates[0] ?? null;
    const unknown: CompanyProfile = {
      name: company ?? domain ?? 'Unknown',
      domain,
      industry: null,
      size: null,
      country: null,
      description: null,
      found: false,
      source: 'none',
    };
    return { data: unknown };
  },
});
