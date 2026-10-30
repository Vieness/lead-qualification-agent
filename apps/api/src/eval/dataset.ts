import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LeadInputSchema, type LeadInput } from '../contracts/index.js';
import { ExpectationSchema, type Expectation } from './expectations.js';

/** data/ at the repo root: samples/ holds leads, expected/ the matching expectations. */
export const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../../../data', import.meta.url));

export type EvalCase = {
  /** Path below samples/ without extension, e.g. "hot-lead" or "attacks/role-play". */
  id: string;
  attack: boolean;
  lead: LeadInput;
  expected: Expectation;
};

async function listJson(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (e) =>
      e.isDirectory()
        ? listJson(join(dir, e.name))
        : e.name.endsWith('.json')
          ? [join(dir, e.name)]
          : [],
    ),
  );
  return nested.flat();
}

/**
 * Loads every sample with its expectation. A sample without an expectation (or an invalid
 * file) is an error: an unchecked sample would silently drop out of the eval.
 */
export async function loadDataset(dataDir = DEFAULT_DATA_DIR): Promise<EvalCase[]> {
  const samplesDir = join(dataDir, 'samples');
  const files = (await listJson(samplesDir)).sort();
  const cases = await Promise.all(
    files.map(async (file) => {
      const id = relative(samplesDir, file).replace(/\.json$/, '');
      const read = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as unknown;
      const lead = LeadInputSchema.safeParse(await read(file));
      if (!lead.success) throw new Error(`samples/${id}.json is not a valid lead`);
      let expected: unknown;
      try {
        expected = await read(join(dataDir, 'expected', `${id}.json`));
      } catch {
        throw new Error(`expected/${id}.json is missing for samples/${id}.json`);
      }
      const parsed = ExpectationSchema.safeParse(expected);
      if (!parsed.success)
        throw new Error(`expected/${id}.json is invalid: ${parsed.error.message}`);
      return { id, attack: id.startsWith('attacks/'), lead: lead.data, expected: parsed.data };
    }),
  );
  return cases.sort((a, b) => Number(a.attack) - Number(b.attack) || a.id.localeCompare(b.id));
}
