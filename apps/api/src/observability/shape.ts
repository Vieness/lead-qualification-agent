const MAX_DEPTH = 4;

/**
 * Describes a value without its text: strings become "<N chars>", arrays and objects keep
 * their structure, numbers and booleans stay. Names and free text cannot be masked by pattern,
 * so logs never carry them; the full (pattern-masked) payload lives in the stored trace.
 */
export function shapeOf(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return `<${value.length} chars>`;
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? `<array(${value.length})>` : '<object>';
  if (Array.isArray(value)) return value.map((item) => shapeOf(item, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shapeOf(v, depth + 1)]));
}
