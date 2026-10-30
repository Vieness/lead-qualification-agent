import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { CompanySizeSchema } from '../contracts/index.js';

/** data/companies.json at the repo root (or /data in Docker). */
export const DEFAULT_COMPANIES_FILE = fileURLToPath(
  new URL('../../../../data/companies.json', import.meta.url),
);

export const CompanyRecordSchema = z.strictObject({
  domain: z.string().min(1),
  name: z.string().min(1),
  industry: z.string().min(1),
  size: CompanySizeSchema,
  country: z.string().regex(/^[A-Z]{2}$/),
  description: z.string(),
});
export type CompanyRecord = z.infer<typeof CompanyRecordSchema>;

/** Source of company data. A JSON file stands in for a real enrichment API (Clearbit etc.). */
export interface CompanyDirectory {
  findByDomain(domain: string): Promise<CompanyRecord | null>;
}

export class JsonCompanyDirectory implements CompanyDirectory {
  private records: Promise<Map<string, CompanyRecord>> | null = null;

  constructor(private readonly file: string = DEFAULT_COMPANIES_FILE) {}

  async findByDomain(domain: string): Promise<CompanyRecord | null> {
    if (!this.records) {
      this.records = this.load();
      // Do not cache a failure: a fixed file should load on the next call
      this.records.catch(() => {
        this.records = null;
      });
    }
    return (await this.records).get(domain.toLowerCase()) ?? null;
  }

  private async load(): Promise<Map<string, CompanyRecord>> {
    const raw: unknown = JSON.parse(await readFile(this.file, 'utf8'));
    const records = z.array(CompanyRecordSchema).parse(raw);
    return new Map(records.map((r) => [r.domain.toLowerCase(), r]));
  }
}

/** In-memory directory for tests. */
export class StaticCompanyDirectory implements CompanyDirectory {
  private readonly records: Map<string, CompanyRecord>;

  constructor(records: CompanyRecord[]) {
    this.records = new Map(records.map((r) => [r.domain.toLowerCase(), r]));
  }

  async findByDomain(domain: string): Promise<CompanyRecord | null> {
    return this.records.get(domain.toLowerCase()) ?? null;
  }
}
