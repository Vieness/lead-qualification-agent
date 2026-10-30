import type { Budget, Currency } from '../contracts/index.js';

/**
 * Fixed demo rates (approximate, October 2026). Scoring only needs the order of magnitude;
 * production would read daily rates from an FX API and store the rate used with the lead.
 */
export const USD_RATES: Record<Currency, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  UAH: 0.024,
};

export function toUsd(amount: number, currency: Currency): number {
  return Math.round(amount * USD_RATES[currency]);
}

/** The upper bound the client named (or the lower bound if that is all we have), in USD. */
export function budgetToUsd(budget: Budget | null): number | null {
  if (!budget) return null;
  const amount = budget.max ?? budget.min;
  return amount === null ? null : toUsd(amount, budget.currency);
}

/** "$500", "$4,999", "$30k", "$97k": exact below $10k, where rounding to thousands misleads. */
export function formatUsd(value: number): string {
  return value < 10_000
    ? `$${Math.round(value).toLocaleString('en-US')}`
    : `$${Math.round(value / 1000)}k`;
}

export const pluralWeeks = (weeks: number) => `${weeks} week${weeks === 1 ? '' : 's'}`;
