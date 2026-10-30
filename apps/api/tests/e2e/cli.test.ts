import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli.js';
import { loadEnv } from '../../src/config/env.js';
import { QualificationResultSchema } from '../../src/contracts/index.js';
import { createMemoryDb } from '../../src/db/memory.js';

const SAMPLES = fileURLToPath(new URL('../../../../data/samples/', import.meta.url));
// DATABASE_URL points nowhere on purpose: the CLI must default to the in-memory database
const env = loadEnv({
  LLM_PROVIDER: 'mock',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none',
});

// One seeded database for the whole file: building one per CLI run made this file slow and
// flaky under load (each PGlite instance boots a WASM Postgres)
let memory: Awaited<ReturnType<typeof createMemoryDb>>;

function capture() {
  const chunks: string[] = [];
  return { write: (text: string) => chunks.push(text), text: () => chunks.join('') };
}

async function cli(...argv: string[]) {
  return runWith({ db: memory.db }, ...argv);
}

async function runWith(io: { db?: typeof memory.db }, ...argv: string[]) {
  const out = capture();
  const err = capture();
  const code = await runCli(argv, { env, out, err, ...io });
  return { code, out: out.text(), err: err.text() };
}

describe('CLI', () => {
  let dir: string;
  beforeAll(async () => {
    memory = await createMemoryDb({ seed: true });
    dir = await mkdtemp(join(tmpdir(), 'cli-'));
    await writeFile(join(dir, 'broken.json'), '{ not json');
    await writeFile(
      join(dir, 'invalid.json'),
      JSON.stringify({ name: 'A', email: 'x', message: 'hi' }),
    );
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    await memory.close();
  });

  it('prints a readable report without Docker or an API key', async () => {
    const { code, out } = await cli(`${SAMPLES}hot-lead.json`);

    expect(code).toBe(0);
    expect(out).toMatch(/^Decision {3}auto_reply \(completed\)/);
    expect(out).toContain('Score breakdown');
    expect(out).toMatch(/Plan \(supervisor\)\n {3}1\. research/);
    expect(out).toMatch(/Tool calls[\s\S]*save_to_crm/);
    expect(out).toContain('Draft reply (en)');
    expect(out).toMatch(/^Run {8}\d+ ms · 4 LLM calls · \d+ in \/ \d+ out tokens$/m);
  });

  it('uses its own in-memory database by default, ignoring DATABASE_URL', async () => {
    const { code, out } = await runWith({}, `${SAMPLES}spam.json`, '--json');
    expect(code).toBe(0);
    expect(JSON.parse(out)).toMatchObject({ decision: 'reject' });
  });

  it('logs run events to stderr with --verbose and keeps stdout valid JSON', async () => {
    const { code, out, err } = await cli(`${SAMPLES}hot-lead.json`, '--json', '--verbose');

    expect(code).toBe(0);
    expect(() => JSON.parse(out)).not.toThrow();
    const events = err
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).event);
    expect(events[0]).toBe('run.start');
    expect(events.at(-1)).toBe('run.finish');
  });

  it('prints the full result as JSON', async () => {
    const { code, out } = await cli(`${SAMPLES}spam.json`, '--json');

    expect(code).toBe(0);
    expect(QualificationResultSchema.parse(JSON.parse(out))).toMatchObject({ decision: 'reject' });
  });

  it.each([
    ['a missing file', 'missing.json', /Cannot read lead/],
    ['broken JSON', 'broken.json', /Cannot read lead/],
    ['an invalid lead', 'invalid.json', /Invalid lead[\s\S]*email/],
  ])('exits with code 2 for %s', async (_case, file, message) => {
    const { code, err } = await cli(join(dir, file));
    expect(code).toBe(2);
    expect(err).toMatch(message);
  });

  it.each([
    ['a mistyped flag', ['--jsno'], /Unknown option '--jsno'/],
    ['a value on a boolean flag', ['--json=yes'], /'--json' does not take an argument/],
    ['a second file', ['extra.json'], /Unexpected arguments: extra.json/],
  ])('rejects %s instead of ignoring it', async (_case, args, message) => {
    const { code, out, err } = await cli(`${SAMPLES}spam.json`, ...args);
    expect(code).toBe(2);
    expect(out).toBe('');
    expect(err).toMatch(message);
    expect(err).toContain('Usage: pnpm agent');
  });

  it('prints usage to stdout for --help', async () => {
    const { code, out } = await cli('--help');
    expect(code).toBe(0);
    expect(out).toMatch(/^Usage: pnpm agent/);
  });

  it('shows usage without arguments', async () => {
    const { code, err } = await cli();
    expect(code).toBe(2);
    expect(err).toMatch(/^Usage: pnpm agent/);
  });
});
