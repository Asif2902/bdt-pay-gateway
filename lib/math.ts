/** Integer/BigInt arithmetic for USDC↔BDT conversions. No floating point. */

/**
 * Calculate required USDC units (ceiling) for a given BDT poisha amount.
 * ceil(amountBdtPoisha * 1_000_000 / ratePoishaPer1Usdc)
 */
export function calcUsdcUnits(amountBdtPoisha: number, ratePoishaPer1Usdc: number): number {
  const num = BigInt(amountBdtPoisha) * BigInt(1_000_000);
  const den = BigInt(ratePoishaPer1Usdc);
  const result = (num + den - 1n) / den;
  return Number(result);
}

/** Convert USDC units back to BDT poisha (floor). */
export function calcBdtPoisha(amountUsdcUnits: number, ratePoishaPer1Usdc: number): number {
  return Math.floor((amountUsdcUnits * ratePoishaPer1Usdc) / 1_000_000);
}
