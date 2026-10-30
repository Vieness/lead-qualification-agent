import { QualificationOutcomeSchema, type QualificationOutcome } from '../contracts/index.js';
import { tierFor } from '../tools/score-lead.js';
import { STATUS_FOR } from './decision.js';

/** Invariants a valid outcome must satisfy beyond its schema. */
export function findInconsistencies(outcome: QualificationOutcome): string[] {
  const problems: string[] = [];
  const { decision, status, draftReply, scoreBreakdown, score, tier } = outcome;

  // A reviewed lead moves from pending_approval to approved without changing its decision
  const approved = decision === 'human_review' && status === 'approved';
  if (status !== STATUS_FOR[decision] && status !== 'failed' && !approved) {
    problems.push(`status "${status}" does not match decision "${decision}"`);
  }
  if (decision === 'auto_reply' && !draftReply) problems.push('auto_reply without a draft');
  if (decision === 'reject' && draftReply) problems.push('rejected lead has a draft');
  if (tier === 'spam' && decision !== 'reject') problems.push('spam tier must be rejected');

  if (scoreBreakdown.length > 0) {
    const sum = scoreBreakdown.reduce((total, item) => total + item.points, 0);
    if (sum !== score) problems.push(`score ${score} differs from breakdown sum ${sum}`);
    // A viability cap overrides the score-based tier (always downwards, to cold)
    const expectedTier = outcome.tierCap ? outcome.tierCap.tier : tierFor(score);
    if (tier !== 'spam' && tier !== expectedTier) {
      problems.push(`tier "${tier}" does not match score ${score}`);
    }
  }
  return problems;
}

/**
 * Last check before persistence. A schema violation is a bug and throws; an inconsistency is
 * downgraded to human review so a defect can never produce an automatic reply.
 */
export function enforceOutcome(outcome: QualificationOutcome): QualificationOutcome {
  const parsed = QualificationOutcomeSchema.parse(outcome);
  const problems = findInconsistencies(parsed);
  if (problems.length === 0) return parsed;

  return QualificationOutcomeSchema.parse({
    ...parsed,
    decision: 'human_review',
    status: 'pending_approval',
    guardrails: {
      ...parsed.guardrails,
      findings: [
        ...parsed.guardrails.findings,
        {
          guard: 'output',
          code: 'inconsistent_outcome',
          severity: 'critical',
          message: `Outcome failed consistency checks: ${problems.join('; ')}`,
        },
      ],
    },
  });
}
