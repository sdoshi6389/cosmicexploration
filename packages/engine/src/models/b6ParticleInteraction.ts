import { HC_EV_NM } from './constants.js';
import type { B6Channel, B6Output, B6ParticleState } from './outputs.js';

export const B6_MODEL_ID = 'b6-particle-interaction';
export const B6_MODEL_VERSION = '2.0.0';

export const B6_ASSUMPTIONS = [
  'Head-on e⁺e⁻ collision with equal kinetic energies: the lab frame is the centre-of-momentum frame.',
  'Executed outcome is the two-photon channel: E_total = 2(mₑc² + T), each photon carries E_total/2, emitted back to back.',
  'The photon emission angle is a chosen display parameter — total momentum is zero for any angle; the angular distribution itself is not computed.',
  'Other channels are listed only as kinematically open/closed by threshold (2m from PDG masses); no cross-sections, branching ratios or angular distributions are computed.',
];

export interface B6Inputs {
  kineticEnergyMeV: number;
  axis: [number, number, number];
  /** Angle between the collision axis and the photon pair, degrees (rotation about z). */
  photonAngleDeg: number;
  electronMassMeV: number;
  thresholds: { label: string; massMeV: number }[];
}

export function computeB6ParticleInteraction(inputs: B6Inputs): B6Output {
  const m = inputs.electronMassMeV;
  const T = Math.max(0, inputs.kineticEnergyMeV);
  const E = m + T;
  const p = Math.sqrt(Math.max(0, E * E - m * m));
  const axis = normalize(inputs.axis);
  const Etot = 2 * E;
  const Eg = Etot / 2;
  const lambdaNm = Eg > 0 ? HC_EV_NM / (Eg * 1e6) : Infinity;
  const gamma = E / m;
  const beta = Math.sqrt(Math.max(0, 1 - 1 / (gamma * gamma)));

  const incoming: B6ParticleState[] = [
    state('e⁻', 11, -1, m, T, E, scale(axis, p)),
    state('e⁺', -11, 1, m, T, E, scale(axis, -p)),
  ];
  const th = (inputs.photonAngleDeg * Math.PI) / 180;
  const photonDir = normalize([
    axis[0] * Math.cos(th) - axis[1] * Math.sin(th),
    axis[0] * Math.sin(th) + axis[1] * Math.cos(th),
    axis[2],
  ]);
  const outgoing: B6ParticleState[] = [
    { ...state('γ', 22, 0, 0, Eg, Eg, scale(photonDir, Eg)), wavelengthNm: lambdaNm },
    { ...state('γ', 22, 0, 0, Eg, Eg, scale(photonDir, -Eg)), wavelengthNm: lambdaNm },
  ];
  const pin = add(incoming[0]!.momentumMevC, incoming[1]!.momentumMevC);
  const pout = add(outgoing[0]!.momentumMevC, outgoing[1]!.momentumMevC);
  const residualP = Math.hypot(pout[0] - pin[0], pout[1] - pin[1], pout[2] - pin[2]);
  const residualE = Math.abs(Etot - 2 * Eg);

  const channels: B6Channel[] = [
    { label: 'e⁺e⁻ → γγ', thresholdMev: 0, open: true, executed: true },
    ...inputs.thresholds.map((t) => ({
      label: t.label,
      thresholdMev: 2 * t.massMeV,
      open: Etot >= 2 * t.massMeV,
      executed: false,
    })),
  ];

  return {
    channel: 'e⁺e⁻ → γγ',
    electronMassMev: m,
    kineticEnergyPerParticleMev: T,
    totalEnergyMev: Etot,
    invariantMassMev: Etot,
    photonEnergyMev: Eg,
    photonWavelengthNm: lambdaNm,
    incomingBetaFractionC: beta,
    lorentzGamma: gamma,
    incoming,
    outgoing,
    channels,
    conservation: {
      energyInMev: Etot,
      energyOutMev: 2 * Eg,
      momentumInMevC: pin,
      momentumOutMevC: pout,
      chargeIn: 0,
      chargeOut: 0,
      leptonNumberIn: 0,
      leptonNumberOut: 0,
      balanced: residualE < 1e-9 && residualP < 1e-9,
      residualEnergyMev: residualE,
      residualMomentumMevC: residualP,
    },
    unsupportedPredictions: [
      'cross-sections and event rates',
      'branching between open channels',
      'photon angular distribution beyond back-to-back toy kinematics',
      'radiative corrections / three-photon annihilation',
    ],
  };
}

function state(
  label: string, pdgId: number, charge: number, massMev: number, T: number, E: number,
  p: [number, number, number],
): B6ParticleState {
  return {
    label, pdgId, charge, massMev, kineticEnergyMev: T, totalEnergyMev: E,
    momentumMevC: p, momentumMagnitudeMevC: Math.hypot(...p),
  };
}

function normalize(v: [number, number, number]): [number, number, number] {
  const n = Math.hypot(...v);
  return n < 1e-12 ? [1, 0, 0] : [v[0] / n, v[1] / n, v[2] / n];
}

function scale(v: [number, number, number], s: number): [number, number, number] {
  return [v[0] * s, v[1] * s, v[2] * s];
}

function add(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
