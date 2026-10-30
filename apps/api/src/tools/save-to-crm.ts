import { SaveToCrmInputSchema, SaveToCrmOutputSchema } from '../contracts/index.js';
import { defineTool } from './types.js';

/** Called by the graph after the guards, never offered to the LLM (see toolRegistry). */
export const saveToCrmTool = defineTool({
  name: 'save_to_crm',
  description: 'Stores the lead and the agent outcome in the CRM.',
  input: SaveToCrmInputSchema,
  output: SaveToCrmOutputSchema,
  execute: async ({ lead, outcome }, ctx) => ({ data: await ctx.leads.create(lead, outcome) }),
});
