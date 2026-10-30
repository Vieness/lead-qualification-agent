import type { CompanyProfile, GuardFinding, LeadInput } from '../contracts/index.js';
import { checkSpam, findInjection } from './patterns.js';
import { findSensitiveData } from './pii.js';

export type InputVerdict = 'pass' | 'review' | 'reject';

export type InputGuardResult = {
  verdict: InputVerdict;
  injectionDetected: boolean;
  findings: GuardFinding[];
};

const quote = (fragments: string[]) =>
  fragments
    .slice(0, 3)
    .map((f) => `"${f.slice(0, 80)}"`)
    .join(', ');

/**
 * Runs before the agent graph. Spam is rejected without any LLM call; suspected prompt
 * injection does not stop processing (the text stays inside data blocks) but forces review.
 */
export function inspectLead(lead: LeadInput): InputGuardResult {
  const findings: GuardFinding[] = [];

  const spam = checkSpam(lead.message);
  if (spam.isSpam) {
    findings.push({
      guard: 'input',
      code: 'spam',
      severity: 'warning',
      message: `Looks like spam: ${spam.reasons.join('; ')}`,
    });
  }

  const injection = findInjection([lead.name, lead.company ?? '', lead.message].join('\n'));
  if (injection.length > 0) {
    findings.push({
      guard: 'input',
      code: 'prompt_injection',
      severity: 'critical',
      message: `Lead contains instruction-like text: ${quote(injection)}`,
    });
  }

  const sensitive = findSensitiveData(lead.message);
  if (sensitive.length > 0) {
    findings.push({
      guard: 'input',
      code: 'pii_detected',
      severity: 'info',
      message: `Message contains ${sensitive.join(' and ')}; masked in logs and traces`,
    });
  }

  const verdict: InputVerdict = spam.isSpam ? 'reject' : injection.length > 0 ? 'review' : 'pass';
  return { verdict, injectionDetected: injection.length > 0, findings };
}

/**
 * Enrichment data comes from the internet too. Instruction-like text there is reported and the
 * free-text description is dropped before it can reach the writer's prompt.
 */
export function inspectEnrichment(company: CompanyProfile): {
  company: CompanyProfile;
  findings: GuardFinding[];
} {
  const injection = findInjection(
    [company.name, company.industry ?? '', company.description ?? ''].join('\n'),
  );
  if (injection.length === 0) return { company, findings: [] };

  return {
    company: { ...company, description: null },
    findings: [
      {
        guard: 'input',
        code: 'prompt_injection',
        severity: 'critical',
        message: `Enrichment data for ${company.domain ?? company.name} contains instruction-like text: ${quote(injection)}`,
      },
    ],
  };
}
