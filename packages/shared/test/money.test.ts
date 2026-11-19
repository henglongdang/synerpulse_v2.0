import { describe, expect, it } from 'vitest';
import {
  allocateEvenly,
  applyBasisPoints,
  centsToDecimalString,
  formatCents,
  parseMoneyToCents,
  ratioToBasisPoints,
  roundHalfAwayFromZero,
} from '../src/money';

describe('parseMoneyToCents', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.05', 1205],
    ['$1,234.56', 123456],
    ['-3.07', -307],
    ['(45.00)', -4500],
    ['.99', 99],
    ['0', 0],
    ['+7', 700],
  ])('parses %s → %d', (input, cents) => {
    expect(parseMoneyToCents(input)).toBe(cents);
  });

  it('avoids float artefacts for numeric input', () => {
    expect(parseMoneyToCents(0.1 + 0.2)).toBe(30);
    expect(parseMoneyToCents(19.99)).toBe(1999);
  });

  it.each(['', 'abc', '1.234', '12..3', '1e5', '--4'])('rejects %s', (bad) => {
    expect(() => parseMoneyToCents(bad)).toThrow();
  });

  it('rejects absurdly large values', () => {
    expect(() => parseMoneyToCents('9999999999999')).toThrow(/too large/);
  });
});

describe('rounding and ratios', () => {
  it('rounds half away from zero symmetrically', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(-2.4)).toBe(-2);
  });
  it('applies basis points with one rounding step', () => {
    expect(applyBasisPoints(10_000, 2000)).toBe(2000); // 20% of $100
    expect(applyBasisPoints(333, 5000)).toBe(167); // 1.665 → 1.67
    expect(applyBasisPoints(-333, 5000)).toBe(-167);
    expect(applyBasisPoints(500_000, -3000)).toBe(-150_000); // -30%
  });
  it('computes ratios in basis points', () => {
    expect(ratioToBasisPoints(50, 200)).toBe(2500);
    expect(ratioToBasisPoints(1, 0)).toBe(0);
  });
  it('allocates evenly without losing cents', () => {
    const parts = allocateEvenly(1000, 3);
    expect(parts).toEqual([334, 333, 333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(allocateEvenly(-100, 3).reduce((a, b) => a + b, 0)).toBe(-100);
  });
});

describe('formatting', () => {
  it('formats with true minus and optional sign', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(-500)).toBe('−$5.00');
    expect(formatCents(500, 'USD', { signed: true })).toBe('+$5.00');
  });
  it('produces exact decimal strings', () => {
    expect(centsToDecimalString(-123405)).toBe('-1234.05');
    expect(centsToDecimalString(7)).toBe('0.07');
  });
});
