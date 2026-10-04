/** Sagan-style convention: K = (log10(P_W) - 6) / 10 for positive usable power. */
export function kardashevFromPowerW(powerW: number): number {
  if (powerW <= 0 || !Number.isFinite(powerW)) return 0;
  return (Math.log10(powerW) - 6) / 10;
}

export function powerWFromKardashev(k: number): number {
  return 10 ** (6 + 10 * k);
}

/** Reference levels: K1 ~ 1e16 W, K2 ~ 1e26 W, K3 ~ 1e36 W */
export const KARDASHEV_REFERENCE_POWER_W: Record<1 | 2 | 3, number> = {
  1: 1e16,
  2: 1e26,
  3: 1e36,
};

export function referenceKardashevLevel(powerW: number): 1 | 2 | 3 {
  if (powerW >= KARDASHEV_REFERENCE_POWER_W[3]) return 3;
  if (powerW >= KARDASHEV_REFERENCE_POWER_W[2]) return 2;
  return 1;
}
