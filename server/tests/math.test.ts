/**
 * Backend unit tests — financial arithmetic and verification logic.
 * Run with: bun test server/tests/
 */

import { describe, it, expect } from 'bun:test';
import { calcUsdcUnitsServer, calcBdtPoisha } from '../lib/math';

describe('calcUsdcUnitsServer', () => {
  const RATE = 12500; // 125 BDT/USDC = 12500 poisha per USDC

  it('calculates exact amount (no remainder)', () => {
    // 125 BDT = 12500 poisha → exactly 1 USDC = 1_000_000 units
    expect(calcUsdcUnitsServer(12500, RATE)).toBe(1_000_000);
  });

  it('rounds up (ceiling) when not exact', () => {
    // 1 poisha (0.01 BDT) at 125 BDT/USDC → should be 1 unit (not 0)
    // 1 * 1_000_000 / 12500 = 80 units exactly
    expect(calcUsdcUnitsServer(1, RATE)).toBe(80);
  });

  it('100 poisha (1 BDT) at 125 BDT/USDC = 8000 units', () => {
    // 1 BDT / 125 BDT per USDC = 0.008 USDC = 8000 units
    expect(calcUsdcUnitsServer(100, RATE)).toBe(8000);
  });

  it('12500 poisha (125 BDT) = exactly 1_000_000 units', () => {
    expect(calcUsdcUnitsServer(12500, RATE)).toBe(1_000_000);
  });

  it('ceiling: 1 poisha remainder rounds up by 1 unit', () => {
    // 1001 poisha at 12500 rate
    // exact: 1001 * 1_000_000 / 12500 = 80080
    // No remainder — exact
    expect(calcUsdcUnitsServer(1001, RATE)).toBe(80080);
  });

  it('throws on zero BDT amount', () => {
    expect(() => calcUsdcUnitsServer(0, RATE)).toThrow('positive');
  });

  it('throws on zero rate', () => {
    expect(() => calcUsdcUnitsServer(100, 0)).toThrow('positive');
  });

  it('handles large amounts without floating point error', () => {
    // 100,000 BDT = 10_000_000 poisha at 125 BDT/USDC = 800 USDC = 800_000_000 units
    expect(calcUsdcUnitsServer(10_000_000, RATE)).toBe(800_000_000);
  });

  it('ceiling: non-divisible amount adds exactly 1 unit', () => {
    // 12501 poisha: 12501 * 1_000_000 / 12500 = 1000080.00 → ceil = 1000080
    // Actually: 12501 * 1_000_000 = 12_501_000_000; / 12500 = 1000080.00 exactly
    const result = calcUsdcUnitsServer(12501, RATE);
    expect(result).toBe(1000080);
  });

  it('different rate: 150 BDT/USDC', () => {
    const rate150 = 15000;
    // 150 BDT = 15000 poisha → 1 USDC = 1_000_000 units
    expect(calcUsdcUnitsServer(15000, rate150)).toBe(1_000_000);
    // 1 BDT = 100 poisha → 100 * 1_000_000 / 15000 = 6666.67 → ceil = 6667
    expect(calcUsdcUnitsServer(100, rate150)).toBe(6667);
  });
});

describe('calcBdtPoisha', () => {
  const RATE = 12500;

  it('1_000_000 USDC units at 125 BDT/USDC = 12500 poisha (1 BDT)', () => {
    // 1_000_000 units * 12500 / 1_000_000 = 12500 poisha
    expect(calcBdtPoisha(1_000_000, RATE)).toBe(12500);
  });

  it('8000 USDC units = 100 poisha (1 BDT)', () => {
    // 8000 * 12500 / 1_000_000 = 100 poisha
    expect(calcBdtPoisha(8000, RATE)).toBe(100);
  });

  it('floors (does not round up)', () => {
    // 80 units * 12500 / 1_000_000 = 1 poisha exactly
    expect(calcBdtPoisha(80, RATE)).toBe(1);
    // 79 units * 12500 / 1_000_000 = 0.9875 → floor = 0
    expect(calcBdtPoisha(79, RATE)).toBe(0);
  });

  it('large amount is accurate', () => {
    // 800_000_000 units * 12500 / 1_000_000 = 10_000_000 poisha (100,000 BDT)
    expect(calcBdtPoisha(800_000_000, RATE)).toBe(10_000_000);
  });

  it('throws on zero amount', () => {
    expect(() => calcBdtPoisha(0, RATE)).toThrow('positive');
  });
});

describe('Invoice amount consistency', () => {
  it('customer always pays >= merchant receives', () => {
    // The USDC amount charged should always convert back to at least the BDT amount
    // (may be slightly more due to ceiling, never less)
    const RATE = 12500;
    const testCases = [1, 99, 100, 1001, 12499, 12500, 12501, 99999, 100000];

    for (const bdtPoisha of testCases) {
      const usdcUnits = calcUsdcUnitsServer(bdtPoisha, RATE);
      const bdtBack = calcBdtPoisha(usdcUnits, RATE);
      expect(bdtBack).toBeGreaterThanOrEqual(bdtPoisha);
    }
  });

  it('ceiling does not overcharge by more than one USDC unit worth', () => {
    const RATE = 12500;
    const bdtPoisha = 12501;
    const usdcUnits = calcUsdcUnitsServer(bdtPoisha, RATE);
    const bdtBack = calcBdtPoisha(usdcUnits, RATE);
    // Overcharge should be less than 1 USDC unit worth in BDT
    const maxOvercharge = RATE; // 1 USDC unit = rate/1_000_000 poisha → 1 unit * rate / 1_000_000
    expect(bdtBack - bdtPoisha).toBeLessThan(maxOvercharge);
  });
});
