import type { Decision, GuardFinding, LeadRecord, Tier } from './types';

export const DECISION: Record<Decision, { label: string; hint: string }> = {
  auto_reply: { label: 'Auto-reply ready', hint: 'No risks found: the draft can be sent.' },
  human_review: {
    label: 'Needs human review',
    hint: 'A person should check the lead before replying.',
  },
  reject: { label: 'Rejected', hint: 'Spam or invalid input: no reply.' },
};

export const TIER: Record<Tier, string> = { hot: 'Hot', warm: 'Warm', cold: 'Cold', spam: 'Spam' };

export const SEVERITY_ORDER: Record<GuardFinding['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export const humanize = (code: string) => code.replace(/_/g, ' ');

/** Status shown to people: an approved lead reads differently from an auto-completed one. */
export function statusLabel(record: Pick<LeadRecord, 'result' | 'approvedAt'>): string {
  switch (record.result.status) {
    case 'pending_approval':
      return 'Waiting for approval';
    case 'approved':
      return 'Approved by a human';
    case 'completed':
      return 'Completed automatically';
    case 'rejected':
      return 'Rejected';
    case 'failed':
      return 'Failed';
  }
}
