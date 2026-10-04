import type { B5Output } from './outputs.js';

export const B5_MODEL_ID = 'b5-nuclear-decay';
export const B5_MODEL_VERSION = '1.0.0';

export const B5_ASSUMPTIONS = [
  'Na-22 → Ne-22* + e⁺ + νₑ via the dominant β⁺ branch to the 1274.5 keV level, followed by the 1274.5 keV γ.',
  'β⁺ endpoint = Q_EC − 2mₑc² − E_level (Q_EC from AME2020 via IAEA LiveChart; mₑ from PDG).',
  'The positron takes a user-chosen fraction of the endpoint energy; the neutrino carries the rest (nuclear recoil neglected).',
  'Single-decay kinematics only: no β spectrum shape, angular correlations or detector response.',
];

export interface B5Inputs {
  halfLifeS: number;
  qEcKeV: number;
  gammaKeV: number;
  electronMassKeV: number;
  positronFraction: number;
  molarMassG: number;
}

const AVOGADRO = 6.02214076e23;

export function computeB5NuclearDecay(inputs: B5Inputs): B5Output {
  const endpoint = Math.max(0, inputs.qEcKeV - 2 * inputs.electronMassKeV - inputs.gammaKeV);
  const frac = Math.min(1, Math.max(0, inputs.positronFraction));
  const tPos = endpoint * frac;
  const eNu = endpoint - tPos;
  const available = inputs.qEcKeV - 2 * inputs.electronMassKeV;
  const accounted = tPos + eNu + inputs.gammaKeV;
  const lambda = Math.LN2 / inputs.halfLifeS;
  const atomsPerUg = (1e-6 / inputs.molarMassG) * AVOGADRO;
  return {
    parent: 'Na-22',
    daughter: 'Ne-22',
    mode: 'beta+',
    halfLifeS: inputs.halfLifeS,
    qEcKeV: inputs.qEcKeV,
    excitedLevelKeV: inputs.gammaKeV,
    positronEndpointKeV: endpoint,
    positronKineticKeV: tPos,
    neutrinoEnergyKeV: eNu,
    gammaKeV: inputs.gammaKeV,
    ledger: {
      chargeIn: 11,
      chargeOut: 10 + 1,
      baryonIn: 22,
      baryonOut: 22,
      leptonIn: 0,
      leptonOut: -1 + 1,
      energyAvailableKeV: available,
      energyAccountedKeV: accounted,
      balanced: Math.abs(available - accounted) < 1e-6,
    },
    activityBqPerMicrogram: lambda * atomsPerUg,
  };
}
