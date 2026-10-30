import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FrontmatterError, parseFrontmatter } from '../../src/db/frontmatter.js';
import { toOrTsQuery } from '../../src/db/repositories/portfolio.js';

const Schema = z.object({ id: z.string(), version: z.string() });

describe('parseFrontmatter', () => {
  it('splits validated frontmatter and trimmed body', () => {
    const source = '---\nid: writer\nversion: "1.0.0"\n---\n\nYou are a writer.\n';
    expect(parseFrontmatter(source, Schema, 'writer.md')).toEqual({
      data: { id: 'writer', version: '1.0.0' },
      body: 'You are a writer.',
    });
  });

  it('fails without a frontmatter block', () => {
    expect(() => parseFrontmatter('Just text', Schema, 'a.md')).toThrow(
      /a\.md: missing frontmatter/,
    );
  });

  it('fails on invalid YAML with the file name', () => {
    expect(() => parseFrontmatter('---\nid: [oops\n---\nbody', Schema, 'b.md')).toThrow(
      /b\.md: invalid YAML/,
    );
  });

  it('fails when frontmatter does not match the schema', () => {
    const run = () => parseFrontmatter('---\nid: writer\n---\nbody', Schema, 'c.md');
    expect(run).toThrow(FrontmatterError);
    expect(run).toThrow(/c\.md: invalid frontmatter[\s\S]*version/);
  });
});

describe('toOrTsQuery', () => {
  it('joins unique words with OR', () => {
    expect(toOrTsQuery('Loyalty mobile app, mobile!')).toBe('loyalty | mobile | app');
  });

  it('drops tsquery operators and one-letter tokens', () => {
    expect(toOrTsQuery("app & !(x | y:*) 'quote'")).toBe('app | quote');
  });

  it('keeps non-English words', () => {
    expect(toOrTsQuery('мобільний застосунок')).toBe('мобільний | застосунок');
  });

  it('returns an empty string when nothing is searchable', () => {
    expect(toOrTsQuery('!!! ?')).toBe('');
  });
});
