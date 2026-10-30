import {
  ExtractRequirementsInputSchema,
  RequirementsSchema,
  type MissingInfo,
  type Requirements,
} from '../contracts/index.js';
import { generateStructured, LLM_PURPOSES } from '../llm/index.js';
import { dataBlock } from '../prompts/data-block.js';
import { defineTool } from './types.js';

const MISSING_ORDER: MissingInfo[] = ['budget', 'timeline', 'scope', 'company'];

// "ASAP" has no number in it, so models sometimes return weeks: null; that hid the shortest
// timelines from the viability gate. \b does not work with Cyrillic, hence two patterns.
const URGENT_EN =
  /\b(asap|a\.s\.a\.p|urgent(ly)?|as soon as possible|immediately|right away|by tomorrow|tomorrow|sofort|dringend)\b/i;
const URGENT_UK = /(терміново|якнайшвидше|якомога швидше|негайно|завтра|срочно)/i;

/** An urgent timeline without a number is at most a week. */
function urgentWeeks(timeline: Requirements['timeline']): Requirements['timeline'] {
  if (!timeline || timeline.weeks !== null) return timeline;
  const urgent = URGENT_EN.test(timeline.raw) || URGENT_UK.test(timeline.raw);
  return urgent ? { ...timeline, weeks: 1 } : timeline;
}

/** Code, not the model, has the final say on what is missing and on urgent timelines. */
export function normalizeRequirements(requirements: Requirements): Requirements {
  const missing = new Set(requirements.missingInfo);
  if (requirements.budget === null) missing.add('budget');
  if (requirements.timeline === null) missing.add('timeline');
  if (requirements.services.length === 0 && requirements.projectType === 'other') {
    missing.add('scope');
  }
  return {
    ...requirements,
    timeline: urgentWeeks(requirements.timeline),
    services: [...new Set(requirements.services)],
    missingInfo: MISSING_ORDER.filter((m) => missing.has(m)),
  };
}

export const extractRequirementsTool = defineTool({
  name: 'extract_requirements',
  description:
    'Extracts project type, services, budget, timeline, goals and missing information from the lead message.',
  input: ExtractRequirementsInputSchema,
  output: RequirementsSchema,
  async execute({ message }, ctx) {
    const prompt = await ctx.prompts.load('extract-requirements');
    const result = await generateStructured(
      ctx.llm,
      {
        purpose: LLM_PURPOSES.extractRequirements,
        system: prompt.text,
        messages: [{ role: 'user', content: dataBlock('lead_message', message) }],
        output: { name: 'requirements', schema: RequirementsSchema },
        effort: 'low',
        ...(ctx.signal && { signal: ctx.signal }),
      },
      { maxRetries: ctx.maxRetries },
    );
    return {
      data: normalizeRequirements(result.data),
      meta: {
        prompt: { id: prompt.id, version: prompt.version },
        retries: result.retries,
        usage: result.usage,
        model: result.model,
      },
    };
  },
});
