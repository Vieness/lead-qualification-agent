import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import type { CompanyProfile, LeadInput } from '../contracts/index.js';
import { checkApproval, inspectEnrichment, resolveReplyLanguage } from '../guards/index.js';
import { enrichCompanyTool, extractRequirementsTool } from '../tools/index.js';
import { failureText, llmFailureFinding, NodeTrace, toolsFor, type AgentDeps } from './context.js';
import type { GraphState, GraphUpdate } from './state.js';

function unknownCompany(lead: LeadInput): CompanyProfile {
  return {
    name: lead.company ?? 'Unknown',
    domain: lead.website ?? null,
    industry: null,
    size: null,
    country: null,
    description: null,
    found: false,
    source: 'none',
  };
}

/**
 * Research agent: what does the client want and who are they? Extraction is an LLM tool
 * called by code (the lead text never travels through model-chosen tool arguments);
 * enrichment is deterministic and its free text is checked before anyone else sees it.
 */
export function researchNode(deps: AgentDeps) {
  const { config } = deps;
  return async (state: GraphState, runConfig?: LangGraphRunnableConfig): Promise<GraphUpdate> => {
    const trace = new NodeTrace(state, 'research', toolsFor(deps, runConfig));
    const { lead } = state;

    const extracted = await trace.call(extractRequirementsTool, { message: lead.message });
    if (!extracted.ok) {
      return trace.update({
        researchFailed: true,
        findings: [llmFailureFinding('research', extracted)],
        errors: [`Requirements extraction failed: ${failureText(extracted)}`],
      });
    }
    const requirements = extracted.result;

    const enriched = await trace.call(enrichCompanyTool, {
      company: lead.company ?? null,
      website: lead.website ?? null,
      emailDomain: lead.email.split('@')[1] ?? '',
    });
    const checked = inspectEnrichment(enriched.ok ? enriched.result : unknownCompany(lead));
    const language = resolveReplyLanguage(requirements.language);

    return trace.update({
      requirements,
      company: checked.company,
      replyLanguage: language.language,
      injectionDetected: checked.findings.length > 0,
      findings: [
        ...checked.findings,
        ...language.findings,
        ...checkApproval(requirements, config.approvalThresholdUsd),
      ],
      errors: enriched.ok ? [] : [`Enrichment failed: ${enriched.error}`],
    });
  };
}
