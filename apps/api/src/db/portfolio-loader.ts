import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PortfolioCaseMetaSchema, type PortfolioCase } from '../contracts/index.js';
import { parseFrontmatter } from './frontmatter.js';

/** Reads every *.md case study in `dir`, validates frontmatter and rejects duplicate ids. */
export async function loadPortfolio(dir: string): Promise<PortfolioCase[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
  const cases: PortfolioCase[] = [];
  const seen = new Map<string, string>();

  for (const file of files) {
    const source = await readFile(join(dir, file), 'utf8');
    const { data, body } = parseFrontmatter(source, PortfolioCaseMetaSchema, file);
    if (!body) throw new Error(`${file}: case study body is empty`);

    const duplicate = seen.get(data.id);
    if (duplicate) throw new Error(`${file}: id "${data.id}" is already used by ${duplicate}`);
    seen.set(data.id, file);

    cases.push({ ...data, body });
  }
  return cases;
}
