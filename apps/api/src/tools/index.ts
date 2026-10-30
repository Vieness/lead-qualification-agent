import type { ToolSpec } from '../llm/index.js';
import { draftReplyTool } from './draft-reply.js';
import { enrichCompanyTool } from './enrich-company.js';
import { extractRequirementsTool } from './extract-requirements.js';
import { saveToCrmTool } from './save-to-crm.js';
import { scoreLeadTool } from './score-lead.js';
import { searchPortfolioTool } from './search-portfolio.js';
import type { Tool } from './types.js';

export * from './company-directory.js';
export * from './currency.js';
export * from './draft-reply.js';
export * from './enrich-company.js';
export * from './extract-requirements.js';
export * from './save-to-crm.js';
export * from './score-lead.js';
export * from './search-portfolio.js';
export * from './types.js';

/**
 * Tools the agents use. Only search_portfolio is handed to the model for autonomous calls
 * (matching agent); the others are called by code with arguments built from state, so the
 * model never chooses inputs for scoring or copies untrusted text into tool arguments.
 * save_to_crm is called by the graph after the guards.
 */
export const toolRegistry = {
  extract_requirements: extractRequirementsTool,
  enrich_company: enrichCompanyTool,
  search_portfolio: searchPortfolioTool,
  score_lead: scoreLeadTool,
  draft_reply: draftReplyTool,
} as const;

export const allTools = { ...toolRegistry, save_to_crm: saveToCrmTool } as const;

/** The view of a tool the LLM sees in a tool-use loop. */
export function toToolSpec(tool: Tool): ToolSpec {
  return { name: tool.name, description: tool.description, input: tool.input };
}
