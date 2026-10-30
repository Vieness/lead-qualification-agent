/** `LLMRequest.purpose` values. Shared by the tools that make the calls and the demo mock that answers them. */
export const LLM_PURPOSES = {
  extractRequirements: 'extract_requirements',
  draftReply: 'draft_reply',
  matchPortfolio: 'match_portfolio',
} as const;
