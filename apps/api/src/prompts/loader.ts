import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parseFrontmatter } from '../db/frontmatter.js';

/** apps/api/prompts, resolved from this file so it works from src/, dist/ and Docker. */
export const DEFAULT_PROMPTS_DIR = fileURLToPath(new URL('../../prompts', import.meta.url));

const PromptMetaSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Expected a semver version like 1.0.0'),
  description: z.string().min(1).max(300),
});

export type Prompt = z.infer<typeof PromptMetaSchema> & { text: string };

export interface PromptLoader {
  load(id: string): Promise<Prompt>;
}

/** Reads versioned prompts from `<dir>/<id>.md` and caches them for the process lifetime. */
export class FilePromptLoader implements PromptLoader {
  private readonly cache = new Map<string, Promise<Prompt>>();

  constructor(private readonly dir: string = DEFAULT_PROMPTS_DIR) {}

  load(id: string): Promise<Prompt> {
    let prompt = this.cache.get(id);
    if (!prompt) {
      prompt = this.read(id);
      // Do not cache failures: a fixed file should load on the next call
      prompt.catch(() => this.cache.delete(id));
      this.cache.set(id, prompt);
    }
    return prompt;
  }

  private async read(id: string): Promise<Prompt> {
    const file = `${id}.md`;
    let source: string;
    try {
      source = await readFile(join(this.dir, file), 'utf8');
    } catch {
      throw new Error(`Prompt "${id}" not found in ${this.dir}`);
    }
    const { data, body } = parseFrontmatter(source, PromptMetaSchema, file);
    if (data.id !== id)
      throw new Error(`${file}: frontmatter id "${data.id}" does not match file name`);
    if (!body) throw new Error(`${file}: prompt text is empty`);
    return { ...data, text: body };
  }
}
