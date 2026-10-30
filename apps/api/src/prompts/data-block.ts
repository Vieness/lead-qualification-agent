const TAG_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Wraps untrusted text (lead messages, enrichment data) in a named block. Prompts tell the
 * model that block content is data, never instructions. Any opening or closing tag with the
 * same name inside the content is removed, so the text cannot close the block early and
 * smuggle in "instructions" after it.
 */
export function dataBlock(tag: string, content: string): string {
  if (!TAG_PATTERN.test(tag)) throw new Error(`Invalid data block tag "${tag}"`);
  const sameTag = new RegExp(`<\\s*/?\\s*${tag}\\b[^>]*>`, 'gi');
  // Repeat until stable: one pass would let "</lead_<lead_message>message>" rebuild the tag
  let clean = content;
  for (let previous = ''; previous !== clean;) {
    previous = clean;
    clean = clean.replace(sameTag, '');
  }
  return `<${tag}>\n${clean}\n</${tag}>`;
}

/** Reads a block back (used by the demo mock to "understand" a request). */
export function readDataBlock(tag: string, text: string): string | null {
  const match = new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(text);
  return match?.[1] ?? null;
}
