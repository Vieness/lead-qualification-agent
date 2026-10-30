import type {
  DraftReply,
  GuardCode,
  GuardFinding,
  Language,
  ReplyLanguage,
  Requirements,
} from '../contracts/index.js';
import { budgetToUsd, formatUsd } from '../tools/currency.js';
import { findInjection, normalize } from './patterns.js';

// Checks the drafted reply with code, not with another LLM. The rules mirror the "must never"
// list in prompts/draft-reply.md: no prices, discounts, deadlines, guarantees or internals.

const MONTHS =
  'january|february|march|april|may|june|july|august|september|october|november|december';

const DRAFT_RULES: Array<{ code: GuardCode; label: string; patterns: RegExp[] }> = [
  {
    code: 'price_promise',
    label: 'mentions a price or amount',
    patterns: [
      /[$€£₴]\s?\d/,
      /\d[\d\s.,]*\s?(k\b|usd|eur|gbp|uah|dollars?|euros?|pounds?|грн|гривень|гривні|доларів|євро)/u,
      /\b(per hour|hourly rate|per month|fixed price)\b|за годину|вартість складе|коштуватиме/u,
    ],
  },
  {
    code: 'discount_promise',
    label: 'offers a discount or free work',
    patterns: [/\bdiscount|\d+\s?% off|\bfor free\b|\bfree of charge\b|знижк|безкоштовн/u],
  },
  {
    code: 'deadline_promise',
    label: 'promises a deadline or duration',
    patterns: [
      new RegExp(
        String.raw`\b(within|in|by)\s+(\d+|a|one|two|three|four|five|six|eight|ten|twelve)\s+(business\s+)?(days?|weeks?|months?)\b`,
      ),
      new RegExp(String.raw`\bby (the end of )?(${MONTHS}|q[1-4]|next week|next month)\b`),
      /\bdeliver(ed)?\b[^.\n]{0,20}\b(by|in|within)\b/,
      /(за|протягом|впродовж)\s+\d+\s+(дн|тиж|місяц)|до кінця (тижня|місяця|року)/u,
    ],
  },
  {
    code: 'guarantee_promise',
    label: 'promises an outcome',
    patterns: [/\bguarantee[ds]?\b|\bwe promise\b|\b100\s?%|гарантуємо|гарантія|обіцяємо/u],
  },
  {
    code: 'internal_leak',
    label: 'mentions internal scoring or prompts',
    patterns: [/\bscor(e|ed|ing)\b|\btier\b|\b(hot|warm|cold) lead\b|\bprompt\b|скоринг|промпт/u],
  },
];

export function checkDraft(draft: DraftReply): GuardFinding[] {
  const { native, latin } = normalize(`${draft.subject}\n${draft.body}`);
  const findings: GuardFinding[] = [];

  for (const rule of DRAFT_RULES) {
    const hit = rule.patterns
      .map((re) => re.exec(latin)?.[0] ?? re.exec(native)?.[0])
      .find(Boolean);
    if (hit) {
      findings.push({
        guard: 'policy',
        code: rule.code,
        severity: 'critical',
        message: `Draft ${rule.label}: "${hit.trim().slice(0, 80)}"`,
      });
    }
  }

  const echoed = findInjection(`${draft.subject}\n${draft.body}`);
  if (echoed.length > 0) {
    findings.push({
      guard: 'policy',
      code: 'prompt_injection',
      severity: 'critical',
      message: `Draft repeats instruction-like text: "${echoed[0]?.slice(0, 80)}"`,
    });
  }
  return findings;
}

/** Big deals always get a human look before anything is sent. */
export function checkApproval(
  requirements: Requirements | null,
  thresholdUsd: number,
): GuardFinding[] {
  const usd = budgetToUsd(requirements?.budget ?? null);
  if (usd === null || usd < thresholdUsd) return [];
  return [
    {
      guard: 'policy',
      code: 'approval_required',
      severity: 'warning',
      message: `Budget ≈ ${formatUsd(usd)} is at or above the ${formatUsd(thresholdUsd)} approval threshold`,
    },
  ];
}

/** Replies are written in English or Ukrainian; any other language falls back to English. */
export function resolveReplyLanguage(language: Language): {
  language: ReplyLanguage;
  findings: GuardFinding[];
} {
  if (language === 'en' || language === 'uk') return { language, findings: [] };
  return {
    language: 'en',
    findings: [
      {
        guard: 'policy',
        code: 'unsupported_language',
        severity: 'info',
        message: `Lead is written in "${language}"; the reply is drafted in English`,
      },
    ],
  };
}
