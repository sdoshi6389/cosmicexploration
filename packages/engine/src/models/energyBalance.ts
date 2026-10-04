import { STEFAN_BOLTZMANN } from './constants.js';

/**
 * Gray-body planetary energy balance (DESIGN.md §9):
 *   T_eq = [ (S(1-a)/4 + F_extra) / (εσ) ]^(1/4) + greenhouse offset
 * An equilibrium estimate — not weather and not a validated climate projection.
 */
export function equilibriumTempK(
  stellarFluxWm2: number,
  albedo: number,
  emissivity: number,
  greenhouseOffsetK: number,
  extraFluxWm2 = 0,
): number {
  const absorbed = (stellarFluxWm2 * (1 - albedo)) / 4 + extraFluxWm2;
  const eps = Math.max(emissivity, 1e-6);
  return (Math.max(absorbed, 0) / (eps * STEFAN_BOLTZMANN)) ** 0.25 + greenhouseOffsetK;
}

/** Greenhouse offset that reproduces an observed mean surface temperature. */
export function greenhouseOffsetFor(
  observedTempK: number,
  stellarFluxWm2: number,
  albedo: number,
  emissivity: number,
): number {
  return observedTempK - equilibriumTempK(stellarFluxWm2, albedo, emissivity, 0);
}
