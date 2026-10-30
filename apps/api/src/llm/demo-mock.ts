import {
  PROJECT_TYPE_LABELS,
  type Budget,
  type Currency,
  type DraftReply,
  type MatchedCase,
  type MissingInfo,
  type ProjectType,
  type Requirements,
  type Service,
  type Timeline,
} from '../contracts/index.js';
import { readDataBlock } from '../prompts/data-block.js';
import { MockProvider } from './mock.js';
import { LLM_PURPOSES } from './purposes.js';
import type { LLMRequest } from './types.js';

// Keyless demo mode (LLM_PROVIDER=mock): regex heuristics stand in for the model so the whole
// pipeline runs offline and deterministically. Good enough for demos and e2e tests, not smart.

// Thousands may be grouped with spaces, commas or dots ("20 000", "20,000", "15.000")
const NUM = String.raw`\d{1,3}(?:[ \u00a0.,]\d{3})+|\d+(?:[.,]\d+)?`;
const MULT = String.raw`k|к|тис\.?|тисяч|thousand|млн|мільйон\p{L}*|million|mio\.?`;
const MILLIONS = /^(млн|мільйон|million|mio)/iu;
const CURRENCY_WORD = String.raw`usd|dollars?|доларів|eur|euros?|євро|gbp|pounds?|uah|грн|гривень|гривні`;

const MONEY = new RegExp(
  String.raw`([$€£])\s?(${NUM})(?:\s?[-–]\s?[$€£]?\s?(${NUM}))?\s?(${MULT})?(?![\p{L}])` +
    String.raw`|(${NUM})(?:\s?[-–]\s?(${NUM}))?\s?(${MULT})?\s?(${CURRENCY_WORD}|[$€£])`,
  'iu',
);

function currencyOf(token: string): Currency {
  const t = token.toLowerCase();
  if (t === '€' || t.startsWith('eur') || t === 'євро') return 'EUR';
  if (t === '£' || t.startsWith('gbp') || t.startsWith('pound')) return 'GBP';
  if (t.startsWith('uah') || t.startsWith('грн') || t.startsWith('грив')) return 'UAH';
  return 'USD';
}

function parseNumber(raw: string): number {
  const compact = raw.replace(/[ \u00a0]/g, '');
  // Groups of exactly three digits are thousands ("20,000", "15.000"); otherwise "2,5" is a decimal
  const normalized = /^\d{1,3}([.,]\d{3})+$/.test(compact)
    ? compact.replace(/[.,]/g, '')
    : compact.replace(',', '.');
  return Number(normalized);
}

export function parseBudget(text: string): Budget | null {
  const match = MONEY.exec(text);
  if (!match) return null;
  const [raw, symbol, a1, a2, m1, b1, b2, m2, word] = match;
  const first = a1 ?? b1;
  if (first === undefined) return null;
  const second = a2 ?? b2;
  const multiplier = m1 ?? m2;
  const factor = multiplier ? (MILLIONS.test(multiplier) ? 1_000_000 : 1000) : 1;

  let min = parseNumber(first) * factor;
  const max = second !== undefined ? parseNumber(second) * factor : min;
  if (second !== undefined && factor > 1 && min > max) min = parseNumber(first);

  const before = text.slice(0, match.index).toLowerCase();
  const upTo = /(up to|under|max(imum)?|до|не більше)\s*$/.test(before);
  return {
    min: upTo ? null : min,
    max,
    currency: currencyOf(symbol ?? word ?? '$'),
    raw: raw.trim(),
  };
}

export function parseTimeline(text: string): Timeline | null {
  const quarter = /\bQ[1-4]\b/i.exec(text);
  if (quarter) return { raw: quarter[0], weeks: 12 };
  const weeks = /(\d+)\s*(weeks?|wks?|тижн\p{L}*|тиж|woche\p{L}*)/iu.exec(text);
  if (weeks?.[1]) return { raw: weeks[0], weeks: Number(weeks[1]) };
  const months = /(\d+)\s*(months?|місяц\p{L}*|міс|monat\p{L}*)/iu.exec(text);
  if (months?.[1]) return { raw: months[0], weeks: Math.round(Number(months[1]) * 4.33) };
  const asap = /\b(asap|urgent(ly)?|tomorrow)\b|терміново|якнайшвидше/iu.exec(text);
  if (asap) return { raw: asap[0], weeks: 1 };
  return null;
}

const SERVICE_PATTERNS: Array<[Service, RegExp]> = [
  ['mobile', /mobile|\bapp\b|ios|android|застосун|мобільн/iu],
  [
    'web',
    /website|web|site|landing|dashboard|portal|platform|e-?commerce|online shop|сайт|веб|інтернет-магазин|платформ/iu,
  ],
  ['design', /design|\bux\b|\bui\b|дизайн/iu],
  ['branding', /brand|logo|identity|бренд|логотип/iu],
  ['marketing', /marketing|\bads\b|\bseo\b|campaign|маркетинг|реклам/iu],
  ['ai_automation', /\bai\b|automation|chatbot|\bllm\b|автоматиз|чат-?бот|штучн/iu],
];

function projectTypeOf(text: string, services: Service[]): ProjectType {
  if (/e-?commerce|online shop|store|інтернет-магазин|магазин/iu.test(text)) return 'ecommerce';
  if (services.includes('mobile')) return 'mobile_app';
  if (services.includes('ai_automation')) return 'ai_automation';
  if (services.includes('web')) return /site|landing|сайт/iu.test(text) ? 'website' : 'web_app';
  if (services.includes('branding')) return 'branding';
  if (services.includes('marketing')) return 'marketing_campaign';
  return 'other';
}

/** Ukrainian by script, German by a few frequent words, English otherwise. */
export function detectLanguage(message: string): string {
  if (/[а-яіїєґ]/iu.test(message)) return 'uk';
  const german =
    message.match(/\b(und|wir|für|eine?n?|ist|brauchen|unsere?|das|die|der|mit)\b/giu) ?? [];
  return german.length >= 3 ? 'de' : 'en';
}

export function heuristicRequirements(message: string): Requirements {
  const services = SERVICE_PATTERNS.filter(([, re]) => re.test(message)).map(([s]) => s);
  const projectType = projectTypeOf(message, services);
  const budget = parseBudget(message);
  const timeline = parseTimeline(message);
  const firstSentence = message
    .split(/[.!?\n]/)[0]
    ?.trim()
    .slice(0, 200);

  const missingInfo: MissingInfo[] = [];
  if (!budget) missingInfo.push('budget');
  if (!timeline) missingInfo.push('timeline');
  if (services.length === 0) missingInfo.push('scope');

  return {
    projectType,
    services,
    budget,
    timeline,
    goals: firstSentence ? [firstSentence] : [],
    missingInfo,
    language: detectLanguage(message),
  };
}

type ReplyContext = {
  leadName: string;
  language: 'en' | 'uk';
  requirements: Requirements;
  matchedCases: Array<Pick<MatchedCase, 'title'>>;
  missingInfo: MissingInfo[];
};

const COPY = {
  en: {
    subject: 'Your project inquiry',
    greeting: (name: string) => `Hi ${name},`,
    thanks: 'Thank you for reaching out.',
    project: (type: ProjectType) =>
      `We understand you are looking for help with your ${PROJECT_TYPE_LABELS[type].en} project.`,
    cases: (titles: string) => `We have done similar work before: ${titles}.`,
    questions: 'To prepare for a first conversation, could you share:',
    missing: {
      budget: 'the budget range you have in mind',
      timeline: 'your ideal timeline',
      scope: 'a bit more about the scope and key features',
      company: 'a few words about your company',
    },
    next: 'Would you be open to a short call this week to discuss the details?',
    sign: 'Best regards,\nThe team',
  },
  uk: {
    subject: 'Ваш запит щодо проєкту',
    greeting: (name: string) => `Вітаємо, ${name}!`,
    thanks: 'Дякуємо, що звернулися до нас.',
    project: (type: ProjectType) =>
      `Наскільки ми зрозуміли, вам потрібна допомога з проєктом: ${PROJECT_TYPE_LABELS[type].uk}.`,
    cases: (titles: string) => `Ми вже виконували схожі проєкти: ${titles}.`,
    questions: 'Щоб підготуватися до першої розмови, підкажіть, будь ласка:',
    missing: {
      budget: 'орієнтовний бюджет',
      timeline: 'бажані терміни',
      scope: 'трохи більше про обсяг робіт і ключові функції',
      company: 'кілька слів про вашу компанію',
    },
    next: 'Чи зручно вам провести короткий дзвінок цього тижня, щоб обговорити деталі?',
    sign: 'З повагою,\nКоманда',
  },
} as const;

export function templateReply(context: ReplyContext): DraftReply {
  const copy = COPY[context.language];
  const titles = context.matchedCases.slice(0, 2).map((c) => c.title);
  const lines = [
    copy.greeting(context.leadName),
    '',
    `${copy.thanks} ${copy.project(context.requirements.projectType)}`,
    ...(titles.length ? [copy.cases(titles.join('; '))] : []),
    ...(context.missingInfo.length
      ? ['', copy.questions, ...context.missingInfo.map((m) => `- ${copy.missing[m]}`)]
      : []),
    '',
    copy.next,
    '',
    copy.sign,
  ];
  return { language: context.language, subject: copy.subject, body: lines.join('\n') };
}

/** The original (first) user message: retries append feedback after it. */
function firstUserText(request: LLMRequest): string {
  const first = request.messages.find((m) => m.role === 'user');
  return first?.content ?? '';
}

type MatchingContext = {
  requirements: Pick<Requirements, 'projectType' | 'services'>;
  company: { industry: string | null };
};

/** One search built from the structured context, then a short summary once results are back. */
function demoSearch(request: LLMRequest) {
  if (request.messages.some((m) => m.role === 'tool')) {
    return { text: 'Selected the most relevant past projects.' };
  }
  const context = JSON.parse(
    readDataBlock('matching_context', firstUserText(request)) ?? '{}',
  ) as MatchingContext;
  const query = [
    context.requirements.projectType.replace(/_/g, ' '),
    ...context.requirements.services.map((s) => s.replace(/_/g, ' ')),
    context.company.industry ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return {
    toolCalls: [
      {
        id: 'demo_search_1',
        name: 'search_portfolio',
        args: { query, services: context.requirements.services, limit: 3 },
      },
    ],
  };
}

export function createDemoMockProvider(): MockProvider {
  return new MockProvider({
    [LLM_PURPOSES.extractRequirements]: (request) => ({
      json: heuristicRequirements(readDataBlock('lead_message', firstUserText(request)) ?? ''),
    }),
    [LLM_PURPOSES.draftReply]: (request) => {
      const context = JSON.parse(
        readDataBlock('reply_context', firstUserText(request)) ?? '{}',
      ) as ReplyContext;
      return { json: templateReply(context) };
    },
    [LLM_PURPOSES.matchPortfolio]: demoSearch,
  });
}
