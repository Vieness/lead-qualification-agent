import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  enrichCompanyTool,
  JsonCompanyDirectory,
  runTool,
  StaticCompanyDirectory,
  type CompanyRecord,
  type ToolContext,
} from '../../../src/tools/index.js';
import { createToolContext } from '../../helpers/tool-context.js';

const acme: CompanyRecord = {
  domain: 'acme-retail.com',
  name: 'Acme Retail',
  industry: 'retail',
  size: '201-1000',
  country: 'UA',
  description: 'x'.repeat(400),
};

let ctx: ToolContext;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ ctx, close } = await createToolContext({ companies: new StaticCompanyDirectory([acme]) }));
});
afterAll(() => close());

async function enrich(args: {
  company: string | null;
  website: string | null;
  emailDomain: string;
}) {
  const run = await runTool(enrichCompanyTool, args, ctx);
  if (!run.ok) throw new Error(run.error);
  return run.result;
}

describe('enrich_company', () => {
  it('finds a company by a messy website URL and truncates the description', async () => {
    const profile = await enrich({
      company: null,
      website: 'https://www.Acme-Retail.com/about?x=1',
      emailDomain: 'gmail.com',
    });
    expect(profile).toMatchObject({
      name: 'Acme Retail',
      found: true,
      source: 'mock_enrichment',
      size: '201-1000',
    });
    expect(profile.description).toHaveLength(300);
  });

  it('falls back to a corporate email domain', async () => {
    const profile = await enrich({
      company: 'Acme',
      website: null,
      emailDomain: 'acme-retail.com',
    });
    expect(profile.found).toBe(true);
  });

  it('does not look up personal email domains', async () => {
    const profile = await enrich({ company: null, website: null, emailDomain: 'gmail.com' });
    expect(profile).toMatchObject({ name: 'Unknown', domain: null, found: false, source: 'none' });
  });

  it('keeps the corporate domain of an unknown company', async () => {
    const profile = await enrich({ company: 'Nova', website: null, emailDomain: 'nova.dev' });
    expect(profile).toMatchObject({ name: 'Nova', domain: 'nova.dev', found: false, size: null });
  });
});

describe('JsonCompanyDirectory', () => {
  it('loads data/companies.json, including the poisoned record used by guard tests', async () => {
    const directory = new JsonCompanyDirectory();
    expect(await directory.findByDomain('BREWLANE.co')).toMatchObject({ name: 'Brewlane Coffee' });
    expect((await directory.findByDomain('growthhackz.biz'))?.description).toMatch(
      /ignore all previous instructions/i,
    );
    expect(await directory.findByDomain('missing.example')).toBeNull();
  });

  it('retries a file that failed to load instead of caching the failure', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'companies-'));
    const file = join(dir, 'companies.json');
    const directory = new JsonCompanyDirectory(file);

    await expect(directory.findByDomain('acme-retail.com')).rejects.toThrow();
    await writeFile(file, JSON.stringify([acme]));
    await expect(directory.findByDomain('acme-retail.com')).resolves.toMatchObject({
      name: 'Acme Retail',
    });
    await rm(dir, { recursive: true, force: true });
  });
});
