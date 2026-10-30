import { describe, expect, it } from 'vitest';
import { findSensitiveData, isLuhnValid, maskPii, maskPiiDeep } from '../../../src/guards/index.js';

describe('maskPii', () => {
  it.each([
    ['Write to olena.k@acme.io', 'Write to [email]@acme.io'],
    ['Call +380 67 123 45 67 today', 'Call [phone ••67] today'],
    ['Tel: 067-123-45-89', 'Tel: [phone ••89]'],
    ['Card 4111 1111 1111 1111', 'Card [card]'],
    ['IBAN UA21 3223 1300 0002 6007 2335 6600 1', 'IBAN [iban]'],
  ])('masks "%s"', (input, expected) => {
    expect(maskPii(input)).toBe(expected);
  });

  it('leaves order numbers, years and amounts alone', () => {
    const text = 'Order 1234567890123 from 2026, budget $30,000';
    expect(maskPii(text)).toBe(text);
  });

  it('masks strings anywhere in nested tool arguments', () => {
    expect(
      maskPiiDeep({ lead: { email: 'a@b.io', tags: ['call 0671234567'] }, count: 2, ok: true }),
    ).toEqual({ lead: { email: '[email]@b.io', tags: ['call [phone ••67]'] }, count: 2, ok: true });
  });
});

describe('sensitive data', () => {
  it('validates card numbers with Luhn', () => {
    expect(isLuhnValid('4111111111111111')).toBe(true);
    expect(isLuhnValid('4111111111111112')).toBe(false);
  });

  it('finds payment data only', () => {
    expect(findSensitiveData('card 4111-1111-1111-1111, IBAN DE89 3704 0044 0532 0130 00')).toEqual(
      ['IBAN', 'payment card number'],
    );
    expect(findSensitiveData('call me at +380671234567')).toEqual([]);
  });
});
