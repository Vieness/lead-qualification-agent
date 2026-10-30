import { DraftReplyInputSchema, DraftReplySchema } from '../contracts/index.js';
import { generateStructured, LLM_PURPOSES } from '../llm/index.js';
import { dataBlock } from '../prompts/data-block.js';
import { defineTool } from './types.js';

export const draftReplyTool = defineTool({
  name: 'draft_reply',
  description:
    'Writes the first reply to the lead in the given language, mentioning similar past projects and asking for missing information. Never includes prices or deadlines.',
  input: DraftReplyInputSchema,
  output: DraftReplySchema,
  async execute(input, ctx) {
    const prompt = await ctx.prompts.load('draft-reply');
    // A reply in the wrong language goes back to the model as a validation error
    const schema = DraftReplySchema.refine((reply) => reply.language === input.language, {
      message: `language must be "${input.language}"`,
      path: ['language'],
    });

    const context = {
      leadName: input.leadName,
      language: input.language,
      tier: input.tier,
      requirements: input.requirements,
      matchedCases: input.matchedCases.map(({ id, title, summary }) => ({ id, title, summary })),
      missingInfo: input.missingInfo,
      ...(input.policyFeedback.length > 0 && { policyFeedback: input.policyFeedback }),
    };

    const result = await generateStructured(
      ctx.llm,
      {
        purpose: LLM_PURPOSES.draftReply,
        system: prompt.text,
        messages: [{ role: 'user', content: dataBlock('reply_context', JSON.stringify(context)) }],
        output: { name: 'draft_reply', schema },
        effort: 'medium',
        ...(ctx.signal && { signal: ctx.signal }),
      },
      { maxRetries: ctx.maxRetries },
    );
    return {
      data: result.data,
      meta: {
        prompt: { id: prompt.id, version: prompt.version },
        retries: result.retries,
        usage: result.usage,
        model: result.model,
      },
    };
  },
});
