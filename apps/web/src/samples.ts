import type { LeadDraft, LeadInputRaw } from './types';

// The same sample leads the CLI, the tests and the eval use: one source of truth in data/samples.
const files = import.meta.glob<LeadInputRaw>('../../../data/samples/**/*.json', {
  eager: true,
  import: 'default',
});

export type Sample = { id: string; label: string; attack: boolean; lead: LeadDraft };

/** Labels where a plain "kebab to words" conversion reads badly. */
const LABELS: Record<string, string> = {
  asap: 'ASAP deadline',
  'uah-budget': 'UAH budget',
  'card-number': 'Card number in text',
  'personal-email': 'Personal email',
  'data-block-breakout': 'Data-block breakout',
};

const toLabel = (id: string) =>
  LABELS[id] ?? id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

export const samples: Sample[] = Object.entries(files)
  .map(([path, lead]) => {
    const id =
      path
        .split('/')
        .at(-1)
        ?.replace(/\.json$/, '') ?? path;
    return {
      id,
      label: toLabel(id),
      attack: path.includes('/attacks/'),
      lead: {
        name: lead.name,
        email: lead.email,
        company: lead.company ?? '',
        website: lead.website ?? '',
        message: lead.message,
      },
    };
  })
  .sort((a, b) => Number(a.attack) - Number(b.attack) || a.id.localeCompare(b.id));
