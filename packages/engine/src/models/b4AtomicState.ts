import type { ScienceLevel, ScienceLine } from '../science.js';
import { EV_TO_JOULE, HC_EV_NM, PLANCK_CONSTANT_J_S } from './constants.js';
import type { B4LevelState, B4Output } from './outputs.js';

export const B4_MODEL_ID = 'b4-atomic-state';
export const B4_MODEL_VERSION = '2.0.0';
export const RYDBERG_EV = 13.605693122994;

export const B4_ASSUMPTIONS = [
  'Level energies are NIST ASD evaluated values for H I (fine-structure J averaged per n,l); the Bohr formula −13.6057/n² eV is used only if a level is missing and is labelled.',
  'ΔE = E_final − E_initial; f = |ΔE|/h; λ = c/f (vacuum).',
  'Electric-dipole selection rule Δl = ±1. Allowed channels show the NIST Einstein A coefficient when evaluated; forbidden ones are flagged and given no rate.',
  'The electron cloud is the analytic hydrogen |ψ_nlm|² (real orbital basis); it is exact for hydrogen and is not claimed for other species.',
];

const ORB = 'spdfghik';

export interface B4Inputs {
  nInitial: number;
  lInitial: number;
  nFinal: number;
  lFinal: number;
  mFinal: number;
  levels: ScienceLevel[];
  lines: ScienceLine[];
  ionizationEv: number;
  useNist: boolean;
}

export function orbitalLabel(n: number, l: number): string {
  return `${n}${ORB[l] ?? `l${l}`}`;
}

/** Mean electron–nucleus distance for hydrogen in Bohr radii: ⟨r⟩ = [3n² − l(l+1)] / 2. */
export function meanRadiusBohr(n: number, l: number): number {
  return (3 * n * n - l * (l + 1)) / 2;
}

function levelEnergy(levels: ScienceLevel[], n: number, l: number, useNist: boolean): { e: number; src: 'nist' | 'bohr' } {
  if (useNist) {
    const rows = levels.filter((r) => r.n === n && r.l === l);
    if (rows.length) {
      // Degeneracy-weighted mean over J (2J+1) collapses fine structure to an (n,l) term energy.
      let num = 0;
      let den = 0;
      for (const r of rows) {
        const j = parseJ(r.j);
        const w = Number.isFinite(j) ? 2 * j + 1 : 1;
        num += r.energyEv * w;
        den += w;
      }
      return { e: num / den, src: 'nist' };
    }
    const nOnly = levels.find((r) => r.n === n && r.l === null);
    if (nOnly) return { e: nOnly.energyEv, src: 'nist' };
  }
  return { e: RYDBERG_EV * (1 - 1 / (n * n)), src: 'bohr' };
}

function parseJ(j: string): number {
  if (!j) return NaN;
  if (j.includes('/')) {
    const [a, b] = j.split('/').map(Number);
    return (a ?? NaN) / (b ?? NaN);
  }
  return Number(j);
}

export function computeB4AtomicState(inputs: B4Inputs): B4Output {
  const nI = clampInt(inputs.nInitial, 1, 12);
  const nF = clampInt(inputs.nFinal, 1, 12);
  const lI = clampInt(inputs.lInitial, 0, nI - 1);
  const lF = clampInt(inputs.lFinal, 0, nF - 1);
  const mF = clampInt(inputs.mFinal, -lF, lF);
  const ei = levelEnergy(inputs.levels, nI, lI, inputs.useNist);
  const ef = levelEnergy(inputs.levels, nF, lF, inputs.useNist);
  // NIST energies are measured from the ground state; shift so the ionisation limit is 0 eV.
  const ion = inputs.ionizationEv;
  const Ei = ei.e - ion;
  const Ef = ef.e - ion;
  const dE = Ef - Ei;
  const absE = Math.abs(dE);
  const process = dE > 1e-9 ? 'absorption' : dE < -1e-9 ? 'emission' : 'none';
  const freq = absE > 0 ? (absE * EV_TO_JOULE) / PLANCK_CONSTANT_J_S : 0;
  const lambdaNm = absE > 0 ? HC_EV_NM / absE : Infinity;
  const allowed = Math.abs(lF - lI) === 1;

  const lower = { n: Math.min(nI, nF) === nI ? nI : nF, l: Math.min(nI, nF) === nI ? lI : lF };
  const upper = lower.n === nI && lower.l === lI ? { n: nF, l: lF } : { n: nI, l: lI };
  const lowerConf = orbitalLabel(lower.n, lower.l);
  const upperConf = orbitalLabel(upper.n, upper.l);
  const matches = inputs.lines.filter((ln) => ln.lowerConf === lowerConf && ln.upperConf === upperConf);
  let aSum: number | null = null;
  let wl: number | null = null;
  if (allowed && matches.length) {
    // Rate out of each upper J = Σ over lower-J components; the (n,l)→(n',l') rate is the
    // (2J+1)-weighted mean of those per-level totals.
    const byUpper = new Map<string, number>();
    for (const m of matches) {
      if (m.akiPerS == null) continue;
      byUpper.set(m.upperJ, (byUpper.get(m.upperJ) ?? 0) + m.akiPerS);
    }
    let num = 0;
    let den = 0;
    for (const [uj, a] of byUpper) {
      const j = parseJ(uj);
      const g = Number.isFinite(j) ? 2 * j + 1 : 1;
      num += a * g;
      den += g;
    }
    aSum = den > 0 ? num / den : null;
    wl = matches[0]!.wavelengthNm;
  }

  const nLow = Math.min(nI, nF);
  const series = ['', 'Lyman', 'Balmer', 'Paschen', 'Brackett', 'Pfund', 'Humphreys'][nLow] ?? null;
  const greek = ['', 'α', 'β', 'γ', 'δ', 'ε', 'ζ'][Math.abs(nF - nI)] ?? '';

  const levels: B4LevelState[] = [];
  for (let n = 1; n <= 6; n++) {
    for (let l = 0; l < Math.min(n, 4); l++) {
      levels.push({
        configuration: orbitalLabel(n, l),
        n,
        l,
        energyEv: levelEnergy(inputs.levels, n, l, inputs.useNist).e - ion,
        occupied: n === nF && l === lF,
      });
    }
  }

  return {
    species: 'H I',
    initial: { configuration: orbitalLabel(nI, lI), n: nI, l: lI, energyEv: Ei },
    final: { configuration: orbitalLabel(nF, lF), n: nF, l: lF, m: mF, energyEv: Ef },
    energySource: ei.src === 'nist' && ef.src === 'nist' ? 'nist' : 'bohr',
    deltaEnergyEv: dE,
    deltaEnergyJ: dE * EV_TO_JOULE,
    process,
    photonFrequencyHz: freq,
    photonWavelengthNm: lambdaNm,
    photonEnergyEv: absE,
    band: bandFor(lambdaNm),
    visibleColorHex: wavelengthToSrgb(lambdaNm),
    selectionRuleAllowed: allowed,
    selectionRuleNote: allowed
      ? aSum != null
        ? `Electric-dipole allowed (Δl = ${lF - lI > 0 ? '+1' : '−1'}); NIST Einstein A available.`
        : 'Electric-dipole allowed (Δl = ±1); no evaluated NIST rate for this channel.'
      : `Dipole-forbidden (Δl = ${lF - lI}); no transition rate is claimed.`,
    einsteinAPerS: aSum,
    upperLifetimeS: aSum ? 1 / aSum : null,
    nistLineWavelengthNm: wl,
    seriesName: series ? `${series}-${greek}` : null,
    ionisationEnergyEv: ion,
    ionised: false,
    levels,
    orbital: { n: nF, l: lF, m: mF, label: orbitalLabel(nF, lF), meanRadiusBohr: meanRadiusBohr(nF, lF) },
  };
}

function bandFor(nm: number): B4Output['band'] {
  if (!Number.isFinite(nm)) return 'none';
  if (nm < 0.01) return 'gamma';
  if (nm < 10) return 'x-ray';
  if (nm < 380) return 'uv';
  if (nm <= 750) return 'visible';
  if (nm < 1e6) return 'infrared';
  if (nm < 1e9) return 'microwave';
  return 'radio';
}

/** Piecewise CIE-like wavelength → sRGB; null outside 380–780 nm. */
export function wavelengthToSrgb(nm: number): string | null {
  if (!Number.isFinite(nm) || nm < 380 || nm > 780) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  if (nm < 440) { r = -(nm - 440) / 60; b = 1; }
  else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510) { g = 1; b = -(nm - 510) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645) { r = 1; g = -(nm - 645) / 65; }
  else r = 1;
  const f = nm < 420 ? 0.3 + (0.7 * (nm - 380)) / 40 : nm > 700 ? 0.3 + (0.7 * (780 - nm)) / 80 : 1;
  const c = (x: number) => Math.round(255 * Math.min(1, Math.max(0, x * f)) ** 0.8);
  return `#${[c(r), c(g), c(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function clampInt(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(Number.isFinite(x) ? x : lo)));
}
