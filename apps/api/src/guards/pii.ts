// PII masking for logs and traces. The CRM keeps the original lead (it is the client's data);
// everything written for debugging or observability goes through maskPii first.

const EMAIL = /[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g;
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?\b/g;
const CARD_CANDIDATE = /\b\d(?:[ -]?\d){12,18}\b/g;
const PHONE = /(?:\+|\b00)\d[\d\s().-]{7,16}\d|\b0\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g;

/** Luhn checksum, so order numbers and dates are not mistaken for card numbers. */
export function isLuhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

export function maskPii(text: string): string {
  return text
    .replace(IBAN, '[iban]')
    .replace(CARD_CANDIDATE, (match) => (isLuhnValid(match.replace(/\D/g, '')) ? '[card]' : match))
    .replace(PHONE, (match) => `[phone ••${match.replace(/\D/g, '').slice(-2)}]`)
    .replace(EMAIL, (_match, domain: string) => `[email]@${domain}`);
}

/** Masks every string inside a JSON-like value (tool args and results in traces). */
export function maskPiiDeep(value: unknown): unknown {
  if (typeof value === 'string') return maskPii(value);
  if (Array.isArray(value)) return value.map(maskPiiDeep);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskPiiDeep(v)]));
  }
  return value;
}

/** Payment data has no place in a sales inquiry; it is reported (and masked in traces). */
export function findSensitiveData(text: string): string[] {
  const found: string[] = [];
  if (text.match(IBAN)) found.push('IBAN');
  const cards = text.match(CARD_CANDIDATE) ?? [];
  if (cards.some((c) => isLuhnValid(c.replace(/\D/g, '')))) found.push('payment card number');
  return found;
}
