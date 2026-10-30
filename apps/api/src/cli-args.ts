import { parseArgs, type ParseArgsConfig } from 'node:util';
import { errorMessage } from './error-message.js';

type Options = NonNullable<ParseArgsConfig['options']>;

/**
 * Strict flag parsing for the CLIs: a mistyped flag (`--repat=3`) is an error, not a silently
 * ignored argument that runs something else than the user asked for.
 */
export function parseCliArgs<O extends Options>(argv: string[], options: O) {
  try {
    const parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true });
    return { ok: true as const, values: parsed.values, positionals: parsed.positionals };
  } catch (err) {
    // Node appends advice about "--" for positionals that start with a dash; not useful here
    return {
      ok: false as const,
      error: errorMessage(err).replace(/\. To specify a positional.*$/s, ''),
    };
  }
}

/** A flag value that must be a whole number ≥ `min`; `undefined` when the flag is absent. */
export function intFlag(name: string, value: string | undefined, min: number): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min) {
    throw new Error(`--${name} must be a whole number of at least ${min}, got "${value}"`);
  }
  return number;
}

/** A flag value that must be a ratio between 0 and 1. */
export function ratioFlag(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (value.trim() === '' || !Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`--${name} must be a number between 0 and 1, got "${value}"`);
  }
  return number;
}
