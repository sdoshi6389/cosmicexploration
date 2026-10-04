import { kardashevFromPowerW } from '../capabilities/kardashev.js';
import { AU_M } from '../science.js';
import { createRng } from '../util/rng.js';
import { STEFAN_BOLTZMANN, SUN_GM_M3_S2, WIEN_B_UM_K } from './constants.js';
import { equilibriumTempK } from './energyBalance.js';
import type { K2CollectorBand, K2CollectorSample, K2Output } from './outputs.js';

export const K2_MODEL_ID = 'k2-dyson-swarm';
export const K2_MODEL_VERSION = '2.0.0';

export const K2_ASSUMPTIONS = [
  'P_intercepted = f × L; P_useful = η × f × L; waste heat = (1 − η) × f × L.',
  'A_effective = f × 4πr² (isotropic projected-area approximation).',
  'Swarm radiates waste heat from its outer surface as a blackbody: T = [P_waste / (4πr²σ)]^¼.',
  'A swarm inside Earth\'s orbit reduces Earth\'s insolation by the captured fraction f (isotropic swarm).',
  'Collector bands are rendered as a deterministic sample separate from the modelled collector count.',
  'Omitted: overlap/shadowing, orbital stability, materials, construction time, stellar wind and radiation pressure.',
];

export interface K2Inputs {
  luminosity_W: number;
  captureFraction: number;
  efficiency: number;
  radius_m: number;
  collectorCount: number;
  seed: number;
  earthAlbedo: number;
  earthEmissivity: number;
  earthGreenhouseOffset_K: number;
}

export function computeK2DysonSwarm(inputs: K2Inputs): K2Output {
  const f = clamp(inputs.captureFraction, 0, 1);
  const eta = clamp(inputs.efficiency, 0, 1);
  const L = Math.max(0, inputs.luminosity_W);
  const r = Math.max(inputs.radius_m, 1e9);
  const n = Math.max(0, Math.floor(inputs.collectorCount));

  const intercepted = f * L;
  const useful = eta * intercepted;
  const waste = intercepted - useful;
  const area = f * 4 * Math.PI * r * r;
  const radiatorT = waste > 0 ? (waste / (STEFAN_BOLTZMANN * 4 * Math.PI * r * r)) ** 0.25 : 0;

  const S1au = L / (4 * Math.PI * AU_M * AU_M);
  const shadowed = r < AU_M;
  const earthS = shadowed ? S1au * (1 - f) : S1au;

  const bandCount = 12;
  const bands: K2CollectorBand[] = [];
  let remaining = n;
  for (let i = 0; i < bandCount; i++) {
    const share = i === bandCount - 1 ? remaining : Math.floor(n / bandCount);
    remaining -= share;
    const radiusM = r * (0.94 + i * 0.011);
    bands.push({
      id: `k2.band.${i}`,
      radiusM,
      inclinationDeg: (i * 180) / bandCount,
      ascendingNodeDeg: (i * 137.5) % 360,
      collectorCount: share,
      periodDays: (2 * Math.PI * Math.sqrt(radiusM ** 3 / SUN_GM_M3_S2)) / 86400,
    });
  }
  // Render sample: density follows the captured fraction so a 2% swarm looks sparse.
  const sampleSize = Math.min(9000, Math.round(600 + 8400 * Math.sqrt(f)));
  const rng = createRng(inputs.seed);
  const collectorSample: K2CollectorSample[] = [];
  for (let i = 0; i < sampleSize; i++) {
    const bandIndex = i % bandCount;
    collectorSample.push({ bandIndex, phase: (i / sampleSize) * Math.PI * 2 * 7 + rng() * 0.4 });
  }

  return {
    starLuminosityW: L,
    captureFraction: f,
    conversionEfficiency: eta,
    orbitalRadiusM: r,
    collectorCount: n,
    interceptedPowerW: intercepted,
    usefulPowerW: useful,
    wasteHeatW: waste,
    effectiveAreaM2: area,
    perCollectorAreaM2: n > 0 ? area / n : 0,
    achievedK: kardashevFromPowerW(useful),
    swarmRadiatorTempK: radiatorT,
    radiatorPeakMicron: radiatorT > 0 ? WIEN_B_UM_K / radiatorT : 0,
    transmittedFraction: 1 - f,
    earthInsolationWm2: earthS,
    earthEquilibriumTempK: equilibriumTempK(
      earthS, inputs.earthAlbedo, inputs.earthEmissivity, inputs.earthGreenhouseOffset_K,
    ),
    earthShadowed: shadowed,
    bands,
    collectorSample,
    omittedEffects: [
      'collector overlap and mutual shadowing',
      'orbital stability and collisions',
      'material availability and construction time',
      'radiation pressure and stellar wind',
      'heat-rejection engineering',
    ],
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
