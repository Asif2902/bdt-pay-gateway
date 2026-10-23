/**
 * Financial arithmetic helpers — integer/BigInt only, no floating point.
 * Mirrors calcUsdcUnits from src/types/index.ts but runs in Node.
 */

const USDC_UNITS_PER_USDC = 1_000_000n;

/**
 * Ceiling division: returns smallest integer >= a/b
 * Uses BigInt to handle large monetary values without overflow.
 */
export function ceilDivBig(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error('Division by zero');
  return (a + b - 1n) / b;
}

/**
 * Calculate USDC units (6 decimal places) required for a BDT amount.
 * Uses ceiling division to ensure the merchant always receives at least
 * the invoiced BDT value.
 *
 * @param bdtPoisha  BDT amount in poisha (1 BDT = 100 poisha)
 * @param ratePoishaPer1Usdc  Exchange rate: poisha per 1 whole USDC
 * @returns USDC units (safe integer)
 */
export function calcUsdcUnitsServer(
  bdtPoisha: number,
  ratePoishaPer1Usdc: number,
): number {
  if (bdtPoisha <= 0) throw new Error('BDT amount must be positive');
  if (ratePoishaPer1Usdc <= 0) throw new Error('Rate must be positive');

  const units = ceilDivBig(
    BigInt(bdtPoisha) * USDC_UNITS_PER_USDC,
    BigInt(ratePoishaPer1Usdc),
  );

  // Safe integer check (JS max safe integer ≈ 9 * 10^15, USDC units fit comfortably)
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Calculated USDC units exceed safe integer range');
  }

  return Number(units);
}

/**
 * Calculate BDT poisha earned from a USDC payment at the given rate.
 * Uses floor division — merchant earns what was agreed.
 */
export function calcBdtPoisha(
  amountUsdcUnits: number,
  ratePoishaPer1Usdc: number,
): number {
  if (amountUsdcUnits <= 0) throw new Error('USDC amount must be positive');
  if (ratePoishaPer1Usdc <= 0) throw new Error('Rate must be positive');

  const result = (BigInt(amountUsdcUnits) * BigInt(ratePoishaPer1Usdc)) / USDC_UNITS_PER_USDC;
  return Number(result);
}
